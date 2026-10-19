#!/usr/bin/env bash
# Installs rfs-agent as a systemd --user service on a Linux node.
# Prefers a prebuilt release binary; otherwise builds from this checkout, fetching a
# current Go toolchain into ~/.local/go if the system one is older than 1.24 (no sudo).
# Usage: deploy/install-agent.sh [extra agent flags, e.g. -readonly or -mounts /data:Data]
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=${RFS_REPO:-Rudra-roy/rfs}
command -v tailscale >/dev/null || { echo "Tailscale must be installed and logged in on this machine"; exit 1; }
mkdir -p ~/.local/bin ~/.config/systemd/user

arch() { case "$(uname -m)" in x86_64) echo amd64;; aarch64|arm64) echo arm64;; armv7l|armv6l) echo armv6l;; *) echo "unsupported arch $(uname -m)" >&2; exit 1;; esac; }

go_ok() { # true when `go` exists and is >= 1.24
  local v; v=$(go version 2>/dev/null | sed -nE 's/.*go([0-9]+)\.([0-9]+).*/\1 \2/p') || return 1
  [ -n "$v" ] || return 1
  set -- $v; [ "$1" -gt 1 ] || [ "$2" -ge 24 ]
}

fetch_release() { # prebuilt binary from the latest GitHub release, if one exists
  local url="https://github.com/$REPO/releases/latest/download/rfs-agent-linux-$(arch)"
  curl -fsSL --retry 2 -o ~/.local/bin/rfs-agent.tmp "$url" 2>/dev/null || return 1
  chmod +x ~/.local/bin/rfs-agent.tmp && mv ~/.local/bin/rfs-agent.tmp ~/.local/bin/rfs-agent
  echo "installed prebuilt rfs-agent from $url"
}

build_from_source() {
  if ! go_ok; then
    if [ -x ~/.local/go/bin/go ]; then export PATH=$HOME/.local/go/bin:$PATH; fi
  fi
  if ! go_ok; then
    local ver; ver=$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)
    echo "system Go is missing or older than 1.24; fetching $ver into ~/.local/go"
    rm -rf ~/.local/go
    curl -fsSL "https://go.dev/dl/${ver}.linux-$(arch).tar.gz" | tar -C ~/.local -xz
    export PATH=$HOME/.local/go/bin:$PATH
  fi
  go build -o ~/.local/bin/rfs-agent ./cmd/agent
  echo "built rfs-agent with $(go version | cut -d' ' -f3)"
}

if [ "${RFS_BUILD:-}" = "1" ] || ! fetch_release; then build_from_source; fi

sed "s|ExecStart=%h/.local/bin/rfs-agent|ExecStart=%h/.local/bin/rfs-agent $*|" deploy/rfs-agent.service > ~/.config/systemd/user/rfs-agent.service
systemctl --user daemon-reload
systemctl --user enable --now rfs-agent
systemctl --user restart rfs-agent
loginctl enable-linger "$USER" 2>/dev/null || echo "note: run 'sudo loginctl enable-linger $USER' so the agent survives logout"
sleep 1; systemctl --user --no-pager status rfs-agent | sed -n '1,5p'
echo "agent installed; it appears in the hub within 15 seconds"
