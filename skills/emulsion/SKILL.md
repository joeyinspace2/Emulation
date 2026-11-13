---
name: emulsion
description: Use when developing or editing photographs, applying film looks, creating reusable photo recipes, or previewing and exporting RAW, JPEG, PNG or WebP photos with Emulsion.
---

# Emulsion

Emulsion is a browser photo renderer with editable JSON recipes. The editor and CLI use the same WebGL/LibRaw engine. Keep original photos unchanged; deliver an editable recipe alongside the rendered image.

## Choose the execution route

- **User's browser:** provide a `.emulsion.json` file. The user opens their photo, chooses **Recipes → Import recipe → Apply recipe**, reviews it, and exports. All processing stays in their browser. A skill cannot access their tab or local photos by itself.
- **Coding agent with files and a terminal:** use the included CLI. It renders locally in Chromium on the machine containing those files. In a cloud agent, this means the agent workspace, not the user's device. Use this route only with photos supplied to that environment.
- **Chat without execution tools:** deliver the recipe and browser steps. Do not claim to have rendered or inspected pixels, or to have a live ChatGPT/Claude connection. This plugin does not provide a remote MCP service.

## Locate the tools

From this skill directory, the launcher is `../../scripts/emulsion.mjs`. Resolve its absolute path; do not assume the working directory is the plugin or project root. Refer to that path as `<launcher>` below.

Requires Node.js 22+. Run `node <launcher> --help`. Before CLI inspection/rendering, run `node <launcher> setup` once. It installs locked dependencies into a writable cache, keeping the plugin files unchanged. For a browser download use `node <launcher> setup --browser`; an existing Chromium can instead be selected with `EMULSION_BROWSER`. `EMULSION_CACHE` overrides the cache directory.

| Job | Command |
| --- | --- |
| Available films and looks | `node <launcher> looks` |
| Validate a recipe | `node <launcher> validate recipe.emulsion.json` |
| Read decoded photo details | `node <launcher> inspect photo.png --software-gl` |
| Render | `node <launcher> render photo.png --recipe recipe.emulsion.json --output preview.jpg --software-gl` |
| Browser editor | `node <launcher> preview` |

Use quoted absolute photo/recipe/output paths when needed. JSON goes to stdout; errors go to stderr with a nonzero exit status. Existing output files require explicit `--overwrite`; originals cannot be overwritten.

## Photo workflow

1. Inspect the supplied original visually when tools permit. Use `looks` for real stock IDs; film looks are artistic approximations.
2. Write a version-1 recipe; use [the contract](references/recipe-format.md) for settings, units, masks and LUT assets. Omitted adjustments reset to defaults. To preserve an existing edit, start from its exported complete recipe.
3. Validate. Render a preview with `--max 1600`, inspect the image, then refine the recipe. `inspect` reports metadata, not an aesthetic assessment.
4. Render the requested export, verify success/dimensions, and deliver both image and recipe. The filename extension must match `output.type`. State any unverified behavior.

Example:
```json
{"format":"emulsion-recipe","version":1,"settings":{"film":"port400","exposure":0.4,"grain":15},"output":{"type":"image/jpeg","quality":0.92,"max":0}}
```

The browser's **Use current edits** captures slider changes and embeds selected LUT/brush assets. Source names are informational, never paths to fetch. Changing `aspect` alone does not crop pixels: specify crop geometry too. Exact pixels can vary across GPUs and browser versions.
