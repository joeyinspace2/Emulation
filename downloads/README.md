# Downloads

[Download Emulsion for Codex / Claude Code](https://github.com/joeyinspace2/Emulation/raw/refs/heads/main/downloads/emulsion-plugin-v0.1.1.zip), or [download the standalone browser editor](https://github.com/joeyinspace2/Emulation/raw/refs/heads/main/Emulsion.html).

The plugin ZIP includes the skill, local renderer, manifests, examples, third-party notices and decoder sources. Node.js 22+ is required for the CLI; its first setup installs locked dependencies and optionally Chromium. The HTML editor needs only a recent browser with WebGL2.

See the [installation instructions](../README.md#install-the-agent-plugin). The ZIP can be uploaded where the client supports plugin uploads, or extracted and added as a local marketplace. Installing from the GitHub marketplace keeps updates available through your client.

Verify a checkout with `cd downloads && sha256sum -c SHA256SUMS`. Rebuild these artifacts from the repository root with `npm ci && npm run build && npm run package:release`.
