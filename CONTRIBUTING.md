# Contributing

Use Node.js 22 or newer. Run `npm ci`, install Chromium with `npx playwright install chromium`, then run `npm run build`, `npm test` and `npm run test:browser`. On Linux, Playwright may also need system libraries (`npx playwright install --with-deps chromium`). An existing Chromium can be selected with `EMULSION_BROWSER`.

Edit source in `src/`; regenerate the tracked HTML with `npm run build`. Recipe contract changes must keep the validator, browser API, CLI, reference docs and skill aligned. Keep original photo files unchanged and keep renderer processing local. Use synthetic fixtures for tests unless you own and can redistribute a sample.

Run `npm run package:release` after changes to distributed files, and commit the updated HTML, ZIP and checksums. CI checks both tests and generated artifacts. Before tagging a release, update the package/lockfile and plugin/marketplace versions together, the download links, and `docs/release-notes.md`. A matching `vX.Y.Z` tag publishes the verified files through GitHub Actions.

Report bugs with browser/OS versions, reproduction steps and the recipe if it is shareable. Avoid attaching private photos to public issues. Describe the visible behavior a pull request changes and how it was checked.
