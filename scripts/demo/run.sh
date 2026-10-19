#!/usr/bin/env bash
# Starts two demo agents (fake machine names, demo folders only) and a demo hub on 127.0.0.1:7440 with auth bypassed.
# Needs: bin/rfs-agent, bin/rfs-hub, tailscale running (agents bind the tailnet IP so the hub's auth path is the real one).
set -euo pipefail
cd "$(dirname "$0")/../.."
data=${RFS_DEMO_DATA:-/tmp/rfs-demo}
[ -d "$data" ] || scripts/demo/make-data.sh "$data"
ip=$(tailscale ip -4)
sed -e "s/AGENT_IP/$ip/g" -e "s/LAST_SEEN/$(date -u -d '5 days ago' +%Y-%m-%dT%H:%M:%SZ)/" scripts/demo/fleet.template.json > /tmp/rfs-demo-fleet.json
pkill -f 'rfs-agent -port 743' 2>/dev/null || true; pkill -f 'rfs-hub -addr 127.0.0.1:7440' 2>/dev/null || true
nohup bin/rfs-agent -port 7431 -mounts "$data/Vault:Vault,$data/Media:Media" >/tmp/rfs-demo-atlas.log 2>&1 &
nohup bin/rfs-agent -port 7432 -mounts "$data/Projects:Projects,$data/Backups:Backups" >/tmp/rfs-demo-nimbus.log 2>&1 &
nohup bin/rfs-hub -addr 127.0.0.1:7440 -dev-email ada@example.com -demo-fleet /tmp/rfs-demo-fleet.json >/tmp/rfs-demo-hub.log 2>&1 &
sleep 2; curl -sf localhost:7440/healthz >/dev/null && echo "demo hub on http://127.0.0.1:7440"
