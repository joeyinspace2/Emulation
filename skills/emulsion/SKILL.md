---
name: emulsion
description: Use when developing or editing photographs, applying film looks, creating reusable photo recipes, or previewing and exporting RAW, JPEG, PNG or WebP photos with Emulsion.
---

# Emulsion

Emulsion is a browser photo renderer with editable JSON recipes. The editor and CLI use the same WebGL/LibRaw engine. Keep original photos unchanged; deliver an editable recipe alongside the rendered image.

## Choose the execution route

- **User's browser:** provide a `.emulsion.json` file. The user opens their photo, chooses **Recipes → Import recipe → Apply recipe**, reviews it, and exports. All processing stays in their browser. A skill cannot access their tab or local photos by itself.
- **Coding agent with files and a terminal:** use the included CLI, and always open the live editor on the photo before editing. It renders locally in Chromium on the machine containing those files. In a cloud agent, this means the agent workspace, not the user's device. Use this route only with photos supplied to that environment.
- **Chat without execution tools:** deliver the recipe and browser steps. Do not claim to have rendered or inspected pixels, or to have a live ChatGPT/Claude connection. This plugin does not provide a remote MCP service.

## Locate the tools

From this skill directory, the launcher is `../../scripts/emulsion.mjs`. Resolve its absolute path; do not assume the working directory is the plugin or project root. Refer to that path as `<launcher>` below.

Requires Node.js 22+. Run `node <launcher> --help`. Before CLI inspection/rendering, run `node <launcher> setup` once. It installs locked dependencies into a writable cache, keeping the plugin files unchanged. For a browser download use `node <launcher> setup --browser`; an existing Chromium can instead be selected with `EMULSION_BROWSER`. `EMULSION_CACHE` overrides the cache directory.

| Job | Command |
| --- | --- |
| Available films, lab scanners and looks | `node <launcher> looks` |
| Validate a recipe | `node <launcher> validate recipe.emulsion.json` |
| Read decoded photo details | `node <launcher> inspect photo.png --software-gl` |
| Render | `node <launcher> render photo.png --recipe recipe.emulsion.json --output preview.jpg --software-gl` |
| Live editor for a photo | `node <launcher> preview photo.png --recipe recipe.emulsion.json` |
| Empty browser editor | `node <launcher> preview` |

Use quoted absolute photo/recipe/output paths when needed. JSON goes to stdout; errors go to stderr with a nonzero exit status. Existing output files require explicit `--overwrite`; originals cannot be overwritten.

## Open the live editor first

Whenever you have the photo file and a terminal, open the editor on that photo **before you make the first edit**, every time, without waiting to be asked. The user watches the edits arrive and can adjust any slider themselves at any point.

1. Choose the recipe path, normally next to the photo (`portrait.emulsion.json`). It does not need to exist: `preview` creates an empty recipe.
2. Start `node <launcher> preview <photo> --recipe <recipe>` as a background process. It runs until stopped, so never wait for it to exit. Its first stdout line is JSON with the `url`. No setup or Chromium is needed for this command.
3. Show that URL in the app's built-in browser or preview pane, using whichever browser, preview or port-reporting tool your client provides. Do not only print the link when you can open it. If the client has no such tool, give the user the URL and continue.
4. Tell the user in one line that the editor is open and that their own adjustments are kept.

The recipe file is the shared state of the session:

- Writing the file updates the open editor within about a second. Apply each edit by saving the recipe file; do not ask the user to import it.
- Adjustments the user makes in the editor are saved into the same file as a complete recipe. **Read the file again before every change and before the final export**, and change only the settings you mean to change. Overwriting it from memory discards the user's adjustments.
- Leave the server running while the user may still want to adjust. If a line on stderr names a refused address, the app opens the editor through a forwarded host: restart with `--allow-host <that host>`.

One live editor serves one photo. For another photo, start another `preview` with its own recipe file.

## Photo workflow

1. Inspect the supplied original visually when tools permit. Use `looks` for real stock IDs; film looks are artistic approximations.
2. Open the live editor as above, then write a version-1 recipe to its recipe file; use [the contract](references/recipe-format.md) for settings, units, masks and LUT assets. Omitted adjustments reset to defaults. To preserve an existing edit, start from its complete recipe.
3. Validate. Render a preview with `--max 1600`, inspect the image, then refine the recipe file. `inspect` reports metadata, not an aesthetic assessment. The editor shows the user the edit; the render is how you see it.
4. Re-read the recipe file, render the requested export from it, verify success/dimensions, and deliver both image and recipe. The filename extension must match `output.type`. State any unverified behavior.

Example:
```json
{"format":"emulsion-recipe","version":1,"settings":{"film":"port400","exposure":0.4,"grain":15},"output":{"type":"image/jpeg","quality":0.92,"max":0}}
```

## Film stock and lab scanner

A film look has two parts: `film` is the stock, and `scan` is the machine that scanned it (`none`, `frontier` for the Fujifilm Frontier SP-3000, `noritsu` for the Noritsu HS-1800). When the user asks for a lab or scanner look, or names one of these machines, set `scan` and adjust that machine's own object; see the Lab scanner section of [the contract](references/recipe-format.md).

- `frontier`: punchy contrast, deep blacks, cool cyan shadows, golden skin. Suits bright, saturated colour work.
- `noritsu`: gentler contrast, open shadows, held highlights, pinker skin. Suits soft light, portraits and black and white.
- Correct colour the way a lab does, with the machine's `d`, `c`, `m`, `y` keys (whole steps; positive density is darker, positive colour adds that colour), before reaching for other colour settings.
- These are models, not measured profiles. Describe them to the user as emulations.

The browser's **Use current edits** captures slider changes and embeds selected LUT/brush assets. Source names are informational, never paths to fetch. Changing `aspect` alone does not crop pixels: specify crop geometry too. Exact pixels can vary across GPUs and browser versions.
