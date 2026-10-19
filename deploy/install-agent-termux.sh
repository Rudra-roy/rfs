#!/data/data/com.termux/files/usr/bin/bash
# Installs rfs-agent on an Android phone, inside Termux, as a background service.
# No clone needed:
#   curl -fsSLO https://raw.githubusercontent.com/Rudra-roy/rfs/main/deploy/install-agent-termux.sh && bash install-agent-termux.sh
# Needs: the Tailscale app connected on this phone, and Termux from F-Droid or GitHub (not Play Store).
set -euo pipefail
REPO=${RFS_REPO:-Rudra-roy/rfs}
[[ "${PREFIX:-}" == *com.termux* ]] || { echo "Run this inside Termux."; exit 1; }
case "$(uname -m)" in aarch64) A=arm64 ;; armv7l|armv8l) A=armv6l ;; x86_64) A=amd64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac

echo "1/5  Packages"
pkg install -y termux-services curl >/dev/null

if [ ! -d ~/storage/shared ]; then
  echo "2/5  Storage: tap Allow in the dialog that opens."
  termux-setup-storage
  for _ in $(seq 20); do [ -d ~/storage/shared ] && break; sleep 1; done
else
  echo "2/5  Storage access already granted"
fi

echo "3/5  rfs-agent ($A), verified against the release checksums"
mkdir -p ~/.local/bin ~/.config/rfs "$PREFIX/tmp"
base="https://github.com/$REPO/releases/latest/download"
curl -fL --retry 5 -C - -o ~/.local/bin/rfs-agent.part "$base/rfs-agent-linux-$A"
curl -fsSL --retry 5 -o "$PREFIX/tmp/rfs-SHA256SUMS" "$base/SHA256SUMS"
want=$(grep " rfs-agent-linux-$A\$" "$PREFIX/tmp/rfs-SHA256SUMS" | cut -d' ' -f1)
have=$(sha256sum ~/.local/bin/rfs-agent.part | cut -d' ' -f1)
[ -n "$want" ] && [ "$want" = "$have" ] || { echo "Checksum mismatch, not installing."; rm -f ~/.local/bin/rfs-agent.part; exit 1; }
chmod +x ~/.local/bin/rfs-agent.part && mv ~/.local/bin/rfs-agent.part ~/.local/bin/rfs-agent

echo "4/5  Settings"
hub=${RFS_HUB:-}
until [[ "$hub" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; do
  read -rp "     Hub's tailnet IP (Tailscale app, tap the hub machine; starts with 100.): " hub </dev/tty
done
if [ ! -f ~/.config/rfs/agent.pass ]; then
  echo "     Set an access password for this phone. Leave empty for none."
  ~/.local/bin/rfs-agent -set-password </dev/tty || true
fi

echo "5/5  Service"
svc="$PREFIX/var/service/rfs-agent"
mkdir -p "$svc/log" "$PREFIX/var/log/sv/rfs-agent"
cat > "$svc/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec $HOME/.local/bin/rfs-agent -allow-from $hub 2>&1
EOF
cat > "$svc/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec svlogd -tt $PREFIX/var/log/sv/rfs-agent
EOF
chmod +x "$svc/run" "$svc/log/run"
# start the service supervisor in this session (new sessions start it themselves)
. "$PREFIX/etc/profile.d/start-services.sh" 2>/dev/null || true
sleep 1
sv-enable rfs-agent >/dev/null 2>&1 || true
sv restart rfs-agent >/dev/null 2>&1 || sv up rfs-agent || true
# start again after a reboot, if the Termux:Boot app is installed
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/rfs-agent <<EOF
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
. $PREFIX/etc/profile.d/start-services.sh
EOF
chmod +x ~/.termux/boot/rfs-agent
termux-wake-lock 2>/dev/null || true
sleep 3
echo
sv status rfs-agent || echo "If the service is not running, close Termux completely, reopen it, and run: sv up rfs-agent"
tail -n 3 "$PREFIX/var/log/sv/rfs-agent/current" 2>/dev/null || true
cat <<EOF

Done. The phone appears in the rack within 15 seconds.
Keep it running:
  - Android Settings > Apps > Termux > Battery > Unrestricted
  - Install Termux:Boot (same source as Termux) and open it once, to start after reboots
  - Optional, for video thumbnails: pkg install ffmpeg
Logs: tail -f $PREFIX/var/log/sv/rfs-agent/current
EOF
