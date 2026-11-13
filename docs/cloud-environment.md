# Codex cloud setup

The reusable installation script is [scripts/cloud-setup.sh](../scripts/cloud-setup.sh). It expects this repository at `/workspace/Emulation`, Node.js 22+, npm and Python 3. It installs the root lockfile and builds a preview outside the checkout, so startup does not rewrite the tracked distribution.

Use this environment installation command:

```sh
bash /workspace/Emulation/scripts/cloud-setup.sh
```

The preview is `/workspace/.emulation-cloud/site/Emulsion.html`. To serve it:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace/.emulation-cloud/site
```

For renderer tests, provide Chromium through `EMULSION_BROWSER` or install it with `npx playwright install --with-deps chromium`. Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md). Use `npm run build` deliberately when changing the checked-in editor.

Dependency installation needs the package registry and browser download hosts. Git operations use the cloud platform's GitHub authentication. GitHub API operations such as checking repository visibility or managing releases also require `api.github.com` to be allowed by the environment's network policy. Store credentials in environment settings, never in this repository.
