#!/bin/sh
set -eu

info() { printf '==> %s\n' "$1"; }
warn() { printf 'warning: %s\n' "$1" >&2; }
fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

os=$(uname -s)
arch=$(uname -m)
info "Detected platform: ${os}/${arch}"

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js was not found on PATH. Install Node.js 22 or newer: https://nodejs.org/en/download"
fi

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  fail "Node.js $(node -v) is too old; YandeCode requires Node.js 22 or newer."
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "npm was not found on PATH. It ships with Node.js: https://nodejs.org/en/download"
fi

if ! command -v claude >/dev/null 2>&1; then
  warn "Claude Code was not found on PATH. Install it before running \"yandecode start\": https://code.claude.com/docs/en/setup"
fi

info "Installing yandecode globally with npm..."
if ! npm install -g yandecode@latest; then
  prefix=$(npm config get prefix 2>/dev/null || echo "<npm prefix>")
  fail "npm install -g yandecode failed, likely a permissions error. Fix your npm prefix instead of using sudo:
  mkdir -p \"\$HOME/.npm-global\"
  npm config set prefix \"\$HOME/.npm-global\"
  export PATH=\"\$HOME/.npm-global/bin:\$PATH\"
  (add the export line to your shell profile, then re-run this script)
Current npm prefix: ${prefix}"
fi

info "Running yandecode doctor..."
yandecode doctor || true

cat <<'EOF'

Next steps:
  cd your-repository
  yandecode init
  yandecode doctor
  yandecode index
  yandecode start
EOF
