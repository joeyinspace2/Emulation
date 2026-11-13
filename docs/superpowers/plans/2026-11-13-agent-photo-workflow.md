# Emulsion Agent Photo Workflow Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement tasks. Checkboxes record verification.

**Goal:** Deliver browser photo recipes and a usable agent plugin/CLI sharing the editor renderer.
**Architecture:** A pure recipe module validates/defaults existing film settings. A browser adapter coordinates existing UI, source loading, assets and export. A CLI automates that public API in Chromium. Plugin packages carry the CLI and skill with the built HTML.
**Tech Stack:** JavaScript, Node.js 22+, existing WebGL2/LibRaw WASM, Playwright, Node test runner.
**Spec:** ../specs/2026-11-13-agent-photo-workflow.md

## Global Constraints
- Use existing isolated cloud checkout; no Git worktree.
- Browser rendering and recipe exchange need no hosted service or credentials.
- Keep the self-contained Emulsion.html artifact.
- Validate before mutation and never silently discard unsupported recipe fields.
- Leave original photos unchanged. No deployment or publication.

## Task 1: Recipe contract
Files: src/recipe.js, src/film.js (CommonJS export only), tests/recipe.test.cjs.
Produces `EmulsionRecipe` browser global / CommonJS module with `validate(recipe)` returning a normalized independent recipe, `create(settings, options={})`, `looks()` returning film/looks metadata, `defaults()` returning fresh defaults. `create` options follow recipe metadata keys; options.assets carries selected LUT. validate throws descriptive Error. Full settings and renderer ranges are checked.
- [x] Add node:test cases proving partial exposure recipes become complete defaults, invalid film/NaN/unknown version/prototype keys fail, and no input mutation.
- [x] Run `node --test tests/recipe.test.cjs` before implementation and record failure.
- [x] Implement strict validation for scalars, nested settings, crop/curve/masks/spots, embedded PNG brush masks and bounded LUT arrays.
- [x] Run validation suite including all built-in looks and default settings; report the exact public API.

## Task 2: Browser adapter and recipe UI
Files: src/automation.js, src/index.html, src/style.css, src/app.js, build/build.mjs, package.json, tests/browser.mjs.
Consumes Task 1 API. Produces window.Emulsion API in the spec. `getRecipe()` and `applyRecipe()` are async; render returns Blob and dimensions. `inspect()` returns app/version/photos/current/settings and loaded image dimensions; no File handles. `openFiles()` accepts File[] and opens first imported photo.
- [x] Create a failing Playwright test that imports sample image and expects Emulsion.ready and applyRecipe.
- [x] Add explicit ready completion from init; await asset decode before render, validate before any application state mutation, serialize API calls, reject source load failures.
- [x] Add recipe dialog including JSON editor, file import, apply and download. Retain editor history and slider synchronization.
- [x] Extend build input list with recipe.js and automation.js; resolve root installed libraw dependency while preserving build-directory installs.
- [x] Test browser round-trip, invalid atomicity, offline rendering, PNG pixel/dimension results, mask/LUT replay and undo/redo.

## Task 3: CLI and local development
Files: bin/emulsion.mjs, lib/automation.mjs, lib/server.mjs, tests/cli.test.mjs, root package manifest/lock.
Consumes public browser API from Task 2, recipe module from Task 1. CLI serves only the compiled HTML over ephemeral loopback port and uploads only the explicit image using Playwright file input/API. Render returns output through browser Blob serialization. It resolves Chromium through EMULSION_BROWSER or Playwright; system chromium fallback is allowed.
- [x] Add failing command behavior and overwrite-protection tests.
- [x] Implement help/looks/validate/inspect/render/preview with validated arguments, explicit file paths, JSON output and guaranteed browser/server cleanup.
- [x] Run actual headless inspect/render tests with a fixture and malformed recipe; confirm output dimensions and no overwrites.

## Task 4: Plugin, skill and delivery
Files: skills/emulsion/SKILL.md and references, .codex-plugin/plugin.json, .claude-plugin/{plugin,marketplace}.json, scripts/package-plugin.mjs, README.md, examples, tests/package.test.mjs.
- [x] Run fresh-agent reference baseline before writing the skill and record knowledge gaps.
- [x] Write skill using verified command paths and recipe examples; distinguish browser-local exchange from coding-agent CLI and unavailable live chat connections.
- [x] Produce versioned ZIP with portable root, both manifests, skill, runtime and exact dependencies; validate extraction and launcher.
- [x] Re-run reference scenario with skill, fix gaps, and have code review assess the implementation.
- [x] Run build, unit, browser, CLI and packaging suites; record verified capabilities and limitations.
