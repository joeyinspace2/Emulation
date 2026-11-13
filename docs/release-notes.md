Emulsion 0.2.0 adds lab scanners and lets a coding agent edit with you in the same editor.

- **Lab scanner** in the Film tab: None, Frontier SP-3000 or Noritsu HS-1800. Each machine has its own panel with density and colour keys and its own tone, contrast, saturation, sharpening and grain controls. Recipes carry the choice as `scan` with a `frontier` or `noritsu` object.

- `emulsion preview <photo> --recipe <file>` opens the editor on that photo with the recipe applied. Saving the recipe file updates the open editor, and edits made in the editor are saved back to the file.
- The skill now opens this live editor in the app's built-in browser before the first edit, every time, so you can adjust the result whenever you want.
- Stopping the plugin launcher also stops its preview server.

The first public version, 0.1.0, introduced a standalone browser darkroom and an installable photo-editing skill for Codex and Claude Code.

- Develop photos and RAW files in the browser, save editable JSON recipes, and export JPEG, PNG or WebP.
- Ask a coding agent to inspect a supplied photo, create a recipe, render a preview and export the result with the same engine.
- Download `Emulsion.html` for the browser editor or the plugin ZIP for clients that support uploads. GitHub marketplace install commands are in the README.
- Includes locked dependencies, tests, third-party notices and the RAW decoder's source/build information.

Browser-only assistants exchange recipes with the open editor. Emulsion does not include a remote MCP endpoint or control a browser tab it did not serve. Client plugin availability varies; Chromium and Node.js 22+ are needed for CLI rendering. Processing runs on the machine hosting the editor or CLI.
