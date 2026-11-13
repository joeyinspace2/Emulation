# Emulsion

A browser darkroom and programmable photo renderer. Edit photos manually, exchange editable recipes with an AI assistant, or use the local CLI from a coding agent. All three routes use the same WebGL2 and LibRaw WebAssembly engine.

**[Download the browser editor](https://github.com/joeyinspace2/Emulation/raw/refs/heads/main/Emulsion.html)** · **[Download the agent plugin](https://github.com/joeyinspace2/Emulation/raw/refs/heads/main/downloads/emulsion-plugin-v0.1.1.zip)** · [Recipe reference](docs/recipe-format.md)

Save `Emulsion.html`, then open it in a recent browser with WebGL2. No installation or API key is needed for the editor. For an AI coding agent, install the plugin below and ask: **“Use Emulsion to give this photo a warm film look and export a JPEG with its editable recipe.”**

## Use the browser editor

Open the downloaded **Emulsion.html** in a recent browser, or serve a checkout with `npm run preview`. The file includes its scripts, styles, film looks and RAW decoder; no runtime CDN or account is required. Import, edit and export continue working offline after loading. Browser policy can restrict opening local HTML files; serving the file on localhost is an alternative.

1. Choose **Add photos** or **Open folder**, then open a photo in Develop.
2. Edit exposure, colour, curves, film looks, crop, masks and healing.
3. Choose **Recipes → Use current edits → Save recipe** to save a portable `.emulsion.json` file.
4. To use an assistant's recipe, choose **Recipes → Import recipe → Apply recipe**. Controls update immediately. **Undo** restores the previous adjustments.
5. Choose **Export** for JPEG, PNG or WebP.

Original photos are preserved. Recipes contain adjustments, selected LUT data and brush masks; they do not include the original photo. A source filename in a recipe is informational. Folder access and persistent catalogue writes depend on browser permissions; individual-photo import and download are available as a fallback.

## Ask an assistant

Example: “Give this portrait a restrained warm film look, lift the shadows, and export a JPEG. Keep the recipe editable.”

- **Browser-only workflow:** an assistant supplies a recipe. Import it into your open editor; processing and export stay on your device.
- **Codex, Claude Code and other coding agents:** the included skill teaches inspection, recipe authoring, validation, preview and export through the local CLI. Before editing, the agent opens the editor on your photo in the app's built-in browser; its edits appear there as it works, and any slider you move is saved back into the recipe it is using. Photos are processed on the agent's machine, so a cloud agent needs the photo explicitly supplied to its workspace.
- **ChatGPT or Claude chat without file-execution tools:** use recipe exchange. This package does not include a hosted MCP endpoint or browser-tab connection. A skill alone cannot access your browser's files. Compatibility with a coding agent does not automatically make it a ChatGPT app or Claude chat connector.

The shared skill lives at [skills/emulsion/SKILL.md](skills/emulsion/SKILL.md). It includes the recipe reference, tool paths, and guidance for checking the rendered result.

## Install the agent plugin

Requires Node.js 22+ for CLI tools. Install once in a client with plugin support; the skill remains available in later sessions. Restart the client after installation if it does not discover the skill immediately.

**Codex CLI** (a current version with `codex plugin`):

```sh
codex plugin marketplace add joeyinspace2/Emulation
codex plugin add emulsion@emulsion
```

**Claude Code:**

```sh
claude plugin marketplace add joeyinspace2/Emulation
claude plugin install emulsion@emulsion
```

In Claude Code, the equivalent interactive commands are `/plugin marketplace add joeyinspace2/Emulation` and `/plugin install emulsion@emulsion`. Ask for Emulsion by name, or invoke its skill where your client exposes skill commands.

**ZIP installation:** [download the plugin](https://github.com/joeyinspace2/Emulation/raw/refs/heads/main/downloads/emulsion-plugin-v0.1.1.zip) and upload it through your client's plugin installation interface where supported. You can also extract it and use the absolute `emulsion/` directory in place of `joeyinspace2/Emulation` in the marketplace commands above. This repository supplies its own marketplace; it is not an approved listing in the vendors' public directories.

**Other agents:** use the complete checkout or extracted plugin and its [skill](skills/emulsion/SKILL.md). The agent needs file and terminal access for automatic rendering. Copying only `SKILL.md` loses its relative tool and reference paths. Agents without these capabilities can still generate recipes to import in the editor.

To build the archive yourself:

```sh
npm ci
npm run build
npm run package:release
```

The result is `downloads/emulsion-plugin-v0.1.1.zip` and `downloads/SHA256SUMS` (also staged in `dist/`). The ZIP contains a single `emulsion/` folder with both plugin manifests, the skill, examples, launcher, compiled HTML, CLI, runtime lockfile, third-party notices and decoder sources. It does not bundle Chromium or `node_modules`.

The launcher resolves paths relative to its own installation, so it works from any photo project directory:

```sh
node /path/to/emulsion/scripts/emulsion.mjs setup
node /path/to/emulsion/scripts/emulsion.mjs looks
```

`setup` installs exact Node dependencies into a content-addressed cache, leaving plugin files untouched. Set `EMULSION_CACHE` to a writable directory if necessary. Use `setup --browser` to download Playwright Chromium, or set `EMULSION_BROWSER` to an existing Chromium executable. Browser download/system dependencies depend on the host environment. The launcher's help, looks, validate and preview commands do not require a browser installation or `setup`.

## Local CLI

Requires Node.js 22+ and Chromium for image inspection/rendering. From a checkout:

```sh
git clone https://github.com/joeyinspace2/Emulation.git
cd Emulation
npm ci
npm run build
npx playwright install chromium
node bin/emulsion.mjs --help
node bin/emulsion.mjs looks
node bin/emulsion.mjs validate examples/warm-portrait.emulsion.json
node bin/emulsion.mjs inspect /path/to/portrait.png --software-gl
node bin/emulsion.mjs render /path/to/portrait.png \
  --recipe examples/warm-portrait.emulsion.json \
  --output /path/to/portrait-preview.jpg --max 1600 --software-gl
npm run preview
node bin/emulsion.mjs preview /path/to/portrait.png --recipe /path/to/portrait.emulsion.json
```

`preview` with a photo starts a live editing session and prints its loopback URL. The editor opens that photo with the recipe applied, and the recipe file becomes shared state: saving the file updates the open editor within about a second, and edits made in the editor are written back to the file as a complete recipe. A missing recipe file is created empty. If both sides change at once, the file's newer contents win and the editor's change stays in its undo history. The photo itself is only read.

`--software-gl` enables Chromium's SwiftShader for machines without a usable GPU. If Chromium is already installed, `EMULSION_BROWSER=/usr/bin/chromium` avoids a browser download. Hardware rendering is also supported when the host provides it.

Commands print JSON to stdout and errors to stderr with a nonzero exit status. The CLI reads only explicit photo and recipe paths, serves only the compiled HTML over loopback, blocks outbound browser requests, and closes the browser/server after each operation. A live `preview` additionally serves its one photo and recipe under an unguessable path, accepts only validated recipes, and refuses requests addressed to anything but a loopback name; `--allow-host <host>` admits one forwarded host when an app shows the editor through its own preview address. A file extension must agree with `recipe.output.type` when specified. Without an output setting, `.jpg`, `.png` or `.webp` selects the encoder. `--max 0` means full size; other positive integers set the maximum long edge.

Existing output files require `--overwrite`. Source photos, recipe inputs and their aliases cannot be overwritten. The CLI deliberately uses a new browser context for each operation: recipe files are the persistent project state.

## Recipe format

```json
{
  "format": "emulsion-recipe",
  "version": 1,
  "name": "Warm portrait",
  "settings": {
    "film": "port400",
    "exposure": 0.4,
    "shadows": 12,
    "grain": 15
  },
  "output": { "type": "image/jpeg", "quality": 0.92, "max": 0 }
}
```

Applying a recipe replaces the current adjustments. Missing values reset to defaults; to preserve an existing edit, start with **Use current edits** and modify that full recipe. `film` selects a stock profile; grain and halation amounts are explicit recipe fields. The `aspect` setting is a crop-tool constraint; use `crop` dimensions to specify an actual crop.

[The complete contract](docs/recipe-format.md) documents every setting, unit, limit, mask and LUT. Unknown fields, unsupported versions, nonfinite values, malformed assets and remote mask URLs are rejected before changing the editor. Use the shared `src/recipe.js` module for validation in Node or `Emulsion.validateRecipe` in the browser.

## Browser API

The compiled app exposes `window.Emulsion`:

```js
await Emulsion.ready;
await Emulsion.openFiles([photoFile]); // a File chosen by the user
await Emulsion.applyRecipe({
  format: 'emulsion-recipe', version: 1,
  settings: { exposure: 0.4, film: 'port400' }
});
const recipe = await Emulsion.getRecipe();
const { blob, width, height } = await Emulsion.render({ type: 'image/png' });
```

| Method | Result |
| --- | --- |
| `ready` | Promise resolving after editor initialization; rejects on failure |
| `inspect()` | Photos, selected photo, decoded dimensions, settings and output options |
| `listLooks()` | Film IDs and built-in look recipes |
| `validateRecipe(recipe)` | Normalized recipe; throws on invalid input |
| `openFiles(File[])` | Imports photos and fully decodes the first |
| `selectPhoto(id)` | Selects and fully decodes an imported photo |
| `applyRecipe(recipe)` | Applies a validated recipe as one undoable edit |
| `getRecipe()` | Complete current recipe with portable brush and LUT assets |
| `render(options)` | `{blob,width,height}` using current settings; no download side effect |
| `undo()` / `redo()` | Changes adjustment history and returns current state |

Mutating API operations are serialized. RAW previews cannot be mistaken for successful full decoding. The API is local to the page; it does not expose a network control endpoint. Output preferences are separate from adjustment undo/redo.

## Develop and verify

The source files are in `src/`. `npm run build` embeds them and the locked LibRaw dependency into `Emulsion.html`. It intentionally updates that tracked distribution file. `build/package-lock.json` retains the original build-directory dependency path for older setups; the root lockfile is the development entry point.

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run package:plugin
```

Tests exercise strict recipe validation, actual headless PNG/JPEG/WebP rendering, source/output protection, extracted plugin structure, offline browser edits, recipe/history/asset round-trips, and synthetic DNG decoding. Browser tests can use `EMULSION_BROWSER` and use software WebGL.

Same-environment PNG checks guard repeatability. Bit-identical pixels across different GPUs, browser versions or image encoders are not guaranteed. RAW compatibility follows LibRaw; the synthetic fixture does not certify every camera format. Full-resolution processing remains subject to the browser's memory and GPU texture limits. Film looks are artistic approximations, not manufacturer profiles.

## License and contributing

Emulsion-authored code is available under the [ISC license](LICENSE). The bundled RAW decoder and runtime components retain their own licenses, including LibRaw under CDDL-1.0. See [third-party notices](THIRD_PARTY_NOTICES.md), [included sources](third_party/sources/) and [decoder build information](docs/raw-decoder-build.md). The standalone HTML carries the license texts with it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release checks. GitHub Actions verifies the build, tests and committed downloads; version tags publish release assets after those checks pass.
