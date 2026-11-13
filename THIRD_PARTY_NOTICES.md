# Third-party notices

Emulsion includes a WebAssembly RAW decoder from **LibRaw-Wasm 1.6.0**, with
LibRaw, Little CMS, and Emscripten runtime and codec components. These components
retain the licenses below. The root ISC license covers Emulsion-authored code.

**This software is based in part on the work of the Independent JPEG Group.**

## Source availability

The LibRaw component is distributed under **CDDL-1.0**, one of the two licenses
offered by its authors. Its complete source, original notices, and license texts
are included in [third_party/sources](third_party/sources/). They are also
available with this release at
<https://github.com/joeyinspace2/Emulation/tree/v0.1.0/third_party/sources>.
The source archives include the original dual-license notices; choosing CDDL for
this distribution does not remove the upstream LGPL alternative.

The same directory contains Little CMS source and the LibRaw-Wasm wrapper and
build source. [Decoder build instructions](docs/raw-decoder-build.md) explain the
toolchain, source pins, upstream prebuilt-library reuse, and Emulsion's worker
changes. [provenance.json](third_party/provenance.json) records source URLs,
commits, archive sizes, hashes, license sources, and the existing binary hash.

Keep this notice and the accompanying license texts with redistributed copies,
including the standalone HTML, npm package, and agent plugin.

## Components

| Component | Version / source | License and notices |
| --- | --- | --- |
| LibRaw-Wasm | 1.6.0, [commit 32fd36a](https://github.com/ybouane/LibRaw-Wasm/tree/32fd36a9883a10c1632bc20073f1ea88cc60487a); author ybouane and contributors named in its package metadata | Upstream declares [ISC](third_party/licenses/LibRaw-Wasm-ISC.txt). Its package metadata is preserved in the wrapper source archive. Upstream supplies no separate LICENSE file or copyright-year notice. |
| LibRaw | 0.22.1, [commit b860248](https://github.com/LibRaw/LibRaw/tree/b860248a89d9082b8e0a1e202e516f46af9adb29) | [CDDL-1.0](third_party/licenses/LibRaw-CDDL-1.0.txt), with the original [COPYRIGHT](third_party/licenses/LibRaw-COPYRIGHT.txt) and [LGPL-2.1 alternative](third_party/licenses/LibRaw-LGPL-2.1.txt) preserved. Copyright 2008–2025 LibRaw LLC. |
| Little CMS | 2.19.1, [commit 21c582a](https://github.com/mm2/Little-CMS/tree/21c582a594fe5279f90c0b93437c398f93bf62b0) | [MIT](third_party/licenses/LittleCMS-MIT.txt), copyright 2023 Marti Maria Saguer. |
| Emscripten glue and runtime | 5.0.7, [commit 263db4c](https://github.com/emscripten-core/emscripten/tree/263db4cffa6f9fc2ec514a70abac81362ea41849) | [Emscripten LICENSE](third_party/licenses/Emscripten-LICENSE.txt), including MIT / University of Illinois NCSA and Node-derived code notices. |
| musl libc | Included by Emscripten | [COPYRIGHT and licenses](third_party/licenses/musl-COPYRIGHT.txt), including MIT and component notices. |
| LLVM runtime components | Included by the Emscripten C/C++ toolchain | [libc++](third_party/licenses/libcxx-LICENSE.txt), [libc++abi](third_party/licenses/libcxxabi-LICENSE.txt), [compiler-rt](third_party/licenses/compiler-rt-LICENSE.txt), and [libunwind](third_party/licenses/libunwind-LICENSE.txt), including Apache-2.0 with LLVM exceptions and component notices. |
| Independent JPEG Group software | libjpeg 9f, selected by the Emscripten 5.0.7 port | [Complete 9f README and terms](third_party/licenses/libjpeg-9f-README.txt), copyright 1991–2024 Thomas G. Lane, Guido Vollbeding. |
| libpng | 1.6.55, selected by the Emscripten 5.0.7 port | [LICENSE](third_party/licenses/libpng-LICENSE.txt). |
| zlib | 1.3.1, selected by the Emscripten 5.0.7 port | [LICENSE](third_party/licenses/zlib-LICENSE.txt). |

The build explicitly enables the JPEG, PNG, and zlib ports. Their notices are
included even where a linker may discard unused code.

LibRaw also acknowledges these contributions:

- Dave Coffin's dcraw code, copyright 1997–2018. LibRaw states that it does not
  use the RESTRICTED dcraw code.
- DCB demosaic and FBDD denoise, copyright 2010 Jacek Gozdz; see the complete
  [BSD notice](third_party/licenses/LibRaw-DCB-FBDD-BSD.txt). The source also
  acknowledges Luis Sanz Rodríguez's FBDD contribution.
- X3F tools, copyright 2010 Roland Karlsson; see the complete
  [BSD notice](third_party/licenses/LibRaw-X3F-BSD.txt).
- Adobe DNG SDK 1.4 code, copyright 2005 Adobe Systems Incorporated, identified
  by LibRaw as MIT licensed; see the
  [copyright and MIT terms](third_party/licenses/LibRaw-Adobe-MIT.txt).

## Emulsion changes and binary provenance

Emulsion changes the JavaScript worker to initialize its WASM from embedded
base64 bytes and to avoid resolving a WASM URL relative to a blob URL. It removes
the worker source-map URL and embeds the resulting worker and unchanged npm
WASM bytes into the HTML. The patches are in `build/build.mjs`. No modification
to LibRaw's native source is represented by these integration changes.

The existing embedded WASM has SHA-256
`8947f7e668e488461c3e9defe7007583aa8477b4886aa603b36b407f2f0846ff` and is
byte-identical to the installed npm 1.6.0 decoder. It differs from the WASM
checked into the upstream source tag. The upstream release process relinks the
wrapper and normally reuses checked-in native static libraries. Emulsion has
not independently reproduced or attested that upstream binary; see the build
instructions for the precise limits and full source rebuild route.
