# RAW decoder source and build

The distributed decoder comes from the locked npm package `libraw-wasm@1.6.0`.
Emulsion embeds its WASM unchanged and applies two JavaScript worker integration
patches in `build/build.mjs`. The source and notices accompany this release at
<https://github.com/joeyinspace2/Emulation/tree/v0.1.0/third_party>.

## Pinned sources

| Source | Version | Commit |
| --- | --- | --- |
| [LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm/tree/32fd36a9883a10c1632bc20073f1ea88cc60487a) | 1.6.0 | `32fd36a9883a10c1632bc20073f1ea88cc60487a` |
| [LibRaw](https://github.com/LibRaw/LibRaw/tree/b860248a89d9082b8e0a1e202e516f46af9adb29) | 0.22.1 | `b860248a89d9082b8e0a1e202e516f46af9adb29` |
| [Little CMS](https://github.com/mm2/Little-CMS/tree/21c582a594fe5279f90c0b93437c398f93bf62b0) | 2.19.1 | `21c582a594fe5279f90c0b93437c398f93bf62b0` |
| [Emscripten](https://github.com/emscripten-core/emscripten/tree/263db4cffa6f9fc2ec514a70abac81362ea41849) | 5.0.7 | `263db4cffa6f9fc2ec514a70abac81362ea41849` |

Complete LibRaw and Little CMS source archives and the complete wrapper/build
source are in [third_party/sources](../third_party/sources/). These archives were
generated from the exact commits with `git archive`; they are not asserted to
match GitHub's generated archive bytes. Check them from that directory with
`sha256sum -c SHA256SUMS`.

The wrapper archive excludes generated JS/WASM, prebuilt native libraries,
copied native headers, and the example RAW photograph. It includes the wrapper,
worker, build scripts, package lockfile, workflows, and tests. The upstream
integration test expects the omitted photograph, available from the exact
upstream checkout. Original notices remain in the archived source files.

Emscripten 5.0.7 selects libjpeg 9f, libpng 1.6.55, and zlib 1.3.1. Its port
scripts pin the downloaded source archives by SHA-512. Exact source URLs and
hashes appear in [provenance.json](../third_party/provenance.json) and in these
upstream scripts:

- [libjpeg.py](https://github.com/emscripten-core/emscripten/blob/263db4cffa6f9fc2ec514a70abac81362ea41849/tools/ports/libjpeg.py)
- [libpng.py](https://github.com/emscripten-core/emscripten/blob/263db4cffa6f9fc2ec514a70abac81362ea41849/tools/ports/libpng.py)
- [zlib.py](https://github.com/emscripten-core/emscripten/blob/263db4cffa6f9fc2ec514a70abac81362ea41849/tools/ports/zlib.py)

The IJG 9f README is preserved from the [exact IJG import
commit](https://github.com/libjpeg-turbo/ijg/blob/7f0b6f5d6767c25dd4585786f59999b503bdd04b/README),
tag `jpeg-9f`, in `third_party/licenses/libjpeg-9f-README.txt`.

## Build from native source

Use a clean LibRaw-Wasm checkout at the commit above, Node.js 20, Emscripten
5.0.7 activated in the shell, and autoconf, automake, libtool, make, and Git.
On macOS the upstream script also supports `glibtoolize`.

```sh
git clone https://github.com/ybouane/LibRaw-Wasm.git LibRaw-Wasm
cd LibRaw-Wasm
git checkout --detach 32fd36a9883a10c1632bc20073f1ea88cc60487a
npm ci
FORCE_LIBS=1 bash compileLibraw.sh
```

`FORCE_LIBS=1` is necessary to rebuild the native libraries: the upstream checkout
already contains `libs/libraw.a` and `libs/liblcms2.a`, and the default script
reuses them. The forced path removes its generated directories, clones the
Little CMS `lcms2.19.1` and LibRaw `0.22.1` tags, runs their autotools builds using
`emconfigure` and `emmake`, then links `libraw_wrapper.cpp`. Verify the cloned
commits against the pins above before treating the result as built from these
sources. For an offline build, extract the accompanying native source archives
and adapt the two clone steps to use those exact trees; record that build-script
change.

The final link enables embind, SIMD, pthreads, JPEG/PNG/zlib ports, ES module
output, memory growth, `-O3`, and LTO. `build.js` uses the locked esbuild
dependency to bundle/minify the worker and glue, creates source maps, and copies
WASM into `dist`. The legacy `makefile` is not the current recipe. The original
script and release workflow are included in the wrapper archive.

After building a replacement decoder, validate RAW decoding and worker behavior
before integrating it. `npm test` runs the upstream routing test; its integration
test requires Chromium and the upstream example photograph. Integrating changed
decoder output into Emulsion also requires updating and reviewing its exact
worker patch points, then running Emulsion's build and browser tests.

## Current binary and reproducibility limits

The current npm WASM is 1,417,725 bytes and hashes to:

```text
8947f7e668e488461c3e9defe7007583aa8477b4886aa603b36b407f2f0846ff
```

It is byte-identical to the WASM embedded in Emulsion. The upstream tag's
checked-in WASM instead hashes to
`e8d03783075f3e6d6eb512b2ea07415e50463c3df2ab80e607c3f8fb770ce94a`.
The release workflow runs `compileLibraw.sh` before publishing to npm; it does
not set `FORCE_LIBS=1`, so it normally relinks the wrapper with existing native
archives. Those exact-tag archives hash to:

```text
271fe1cf575f8d6ffa7dc1749e66c100665ab3b3c38c95a8c340ae8628029af2  libs/libraw.a
cc694903a97676f0fb91c305c98cb6e081ae402d52aad8484dd8e0bfbdcba517  libs/liblcms2.a
```

The included LibRaw version header identifies 0.22.1; the build script pins that
release and Little CMS 2.19.1. These records support the source identification
without independently proving the origin of those upstream prebuilt archives.
Emulsion has not independently reproduced the npm WASM or verified a release
attestation. A full source rebuild may produce different bytes. To investigate
the original linking path, use the exact upstream checkout and its existing
archives without `FORCE_LIBS=1`; those binary archives are intentionally not
duplicated in the accompanying wrapper source archive.

## Emulsion embedding changes

`build/build.mjs` reads the installed `dist/worker.js`, removes its source-map URL,
and replaces:

1. `(await Kt())` with initialization that passes a `wasmBinary` byte array
   decoded from the worker's `self.__b64` value.
2. `new URL("libraw.wasm",import.meta.url).href` with the unused string
   `"libraw.wasm"`, avoiding URL resolution against a blob URL.

It then embeds that worker and the base64-encoded original WASM bytes in
`Emulsion.html`. The embedding process also carries the third-party notices and
license texts so that a standalone copy retains them. The native LibRaw source
is not changed by these JavaScript integration patches.
