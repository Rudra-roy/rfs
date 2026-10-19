#!/usr/bin/env bash
# Builds rfs-agent from this checkout and installs it as a systemd --user service on a Linux node.
# Usage: deploy/install-agent.sh [extra agent flags, e.g. -readonly or -mounts /data:Data]
set -euo pipefail
cd "$(dirname "$0")/.."
command -v go >/dev/null || { echo "Go 1.24+ is required (https://go.dev/dl)"; exit 1; }
command -v tailscale >/dev/null || { echo "Tailscale must be installed and logged in on this machine"; exit 1; }
mkdir -p ~/.local/bin ~/.config/systemd/user
go build -o ~/.local/bin/rfs-agent ./cmd/agent
sed "s|ExecStart=%h/.local/bin/rfs-agent|ExecStart=%h/.local/bin/rfs-agent $*|" deploy/rfs-agent.service > ~/.config/systemd/user/rfs-agent.service
systemctl --user daemon-reload
systemctl --user enable --now rfs-agent
loginctl enable-linger "$USER" 2>/dev/null || echo "note: run 'loginctl enable-linger $USER' as root so the agent survives logout"
sleep 1; systemctl --user --no-pager status rfs-agent | head -5
echo "agent installed; it appears in the hub within 15 seconds"
