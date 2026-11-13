Emulsion's first public version: a standalone browser darkroom and an installable photo-editing skill for Codex and Claude Code.

- Develop photos and RAW files in the browser, save editable JSON recipes, and export JPEG, PNG or WebP.
- Ask a coding agent to inspect a supplied photo, create a recipe, render a preview and export the result with the same engine.
- Download `Emulsion.html` for the browser editor or the plugin ZIP for clients that support uploads. GitHub marketplace install commands are in the README.
- Includes locked dependencies, tests, third-party notices and the RAW decoder's source/build information.

Browser-only assistants exchange recipes with the open editor. This release does not include a remote MCP endpoint or control an already-open browser tab. Client plugin availability varies; Chromium and Node.js 22+ are needed for CLI rendering. Processing runs on the machine hosting the editor or CLI.
