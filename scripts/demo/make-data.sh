#!/usr/bin/env bash
# Generates a synthetic demo tree under $1 (default /tmp/rfs-demo) with ffmpeg: nothing personal in it.
set -euo pipefail
root=${1:-/tmp/rfs-demo}
rm -rf "$root"; mkdir -p "$root"/{Vault/Documents,Vault/Finance,Media/Photos,Media/Clips,Media/Music,Projects/rfs,Projects/thesis,Backups}
ff() { ffmpeg -v error -y "$@"; }
for i in $(seq 1 14); do ff -f lavfi -i "gradients=s=960x720:seed=$((i*7)):nb_colors=3" -frames:v 1 "$root/Media/Photos/IMG_$((4100+i)).jpg"; done
ff -f lavfi -i "mandelbrot=s=960x720" -frames:v 1 "$root/Media/Photos/fractal.png"
ff -f lavfi -i "life=s=960x720:mold=10:r=60:ratio=0.1" -frames:v 1 "$root/Media/Photos/automaton.png"
for i in 1 2 3; do ff -f lavfi -i "testsrc2=s=640x360:d=4:r=24" -pix_fmt yuv420p "$root/Media/Clips/clip_0$i.mp4"; done
ff -f lavfi -i "sine=f=440:d=3" "$root/Media/Music/tone_a4.wav"
ff -f lavfi -i "sine=f=660:d=3" "$root/Media/Music/tone_e5.wav"
cat > "$root/Vault/Documents/README.md" <<'MD'
# Vault

Personal documents. Nothing here is synced; it is read in place by rfs-agent.
MD
printf 'date,vendor,amount\n2026-03-02,Hetzner,4.51\n2026-03-09,Namecheap,12.98\n2026-03-21,Cloudflare,0.00\n' > "$root/Vault/Finance/ledger-2026-03.csv"
printf 'meeting notes\n- agents on every box\n- trash, never unlink\n' > "$root/Vault/Documents/notes.txt"
printf 'hub:\n  addr: 127.0.0.1:7420\nagents:\n  port: 7421\n' > "$root/Vault/Documents/config.yaml"
printf 'package main\n\nfunc main() { println("hello from the rack") }\n' > "$root/Projects/rfs/main.go"
printf 'export const greet = (n: string) => `hi ${n}`\n' > "$root/Projects/rfs/greet.ts"
printf 'import numpy as np\nprint(np.arange(3))\n' > "$root/Projects/thesis/analysis.py"
printf 'chapter,words\n1,4200\n2,5100\n' > "$root/Projects/thesis/progress.csv"
(cd "$root/Projects" && zip -qr "$root/Backups/projects-2026-03.zip" rfs thesis)
tar -C "$root/Vault" -czf "$root/Backups/vault-2026-03.tar.gz" Documents Finance
head -c 3000000 /dev/urandom > "$root/Backups/disk-image.img"
echo "demo data in $root"
