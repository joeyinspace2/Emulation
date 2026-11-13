#!/usr/bin/env bash
set -euo pipefail
repo=/workspace/Emulation
state=/workspace/.emulation-cloud
command -v node >/dev/null
command -v npm >/dev/null
command -v python3 >/dev/null
mkdir -p "$state/site" "$state/logs"
cd "$repo"
npm ci --cache "$state/npm-cache" --no-audit --no-fund
cat > "$state/rebuild.sh" <<'BUILD'
#!/usr/bin/env bash
set -euo pipefail
repo=/workspace/Emulation
state=/workspace/.emulation-cloud
work=$(mktemp -d "$state/build-run.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/build"
cp -R "$repo/src" "$work/src"
mkdir -p "$work/third_party"
cp -R "$repo/third_party/licenses" "$work/third_party/licenses"
cp "$repo/LICENSE" "$repo/THIRD_PARTY_NOTICES.md" "$work/"
cp "$repo/build/build.mjs" "$work/build/build.mjs"
ln -s "$repo/node_modules" "$work/build/node_modules"
node "$work/build/build.mjs"
mkdir -p "$state/site"
cp "$work/Emulsion.html" "$state/site/Emulsion.html"
BUILD
chmod +x "$state/rebuild.sh"
"$state/rebuild.sh"
node "$repo/bin/emulsion.mjs" validate "$repo/examples/warm-portrait.emulsion.json" >/dev/null
