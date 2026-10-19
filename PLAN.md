# rfs — distributed personal file server

One web UI at `files.example.com` that shows every machine on the tailnet, every
drive on each machine, and lets you browse / stream / download / upload from
anywhere. Nothing is copied or synced: bytes stay where they live and are read on
demand over Tailscale.

## 0. Assumptions (correct me)

- Single owner (you). No multi-tenant users, no sharing links in v1.
- Machines are Linux + Windows (tailnet shows both). macOS not needed.
- "Every drive" means every mounted filesystem the OS can see, including removable.
- No inbound ports on any machine (this box is on `172.19.x` behind campus NAT,
  public IP is not yours to forward). Confirmed: nothing listening on 80/443.
- The domain is at a registrar whose nameservers you can change.
- Node 22 and Docker exist on the hub box. Go must be installed fresh (1.18 → ≥1.24).
- Hub is `hub-box` (always on). Laptops run agents only.

## 1. Architecture

```
 browser (anywhere)                         browser (on tailnet)
      │ https                                      │ https, 1 hop, no cloud  (phase 3)
      ▼                                            ▼
 Cloudflare edge ── Access: Google login ──┐       │
      │ tunnel (outbound from hub)         │       │
      ▼                                    ▼       ▼
 ┌──────────── hub (hub-box) ────────────────────────────┐
 │ rfs-hub : web UI, session/JWT check, machine registry, │
 │           proxy → agents, audit log                    │
 └───────────────┬────────────────────────────────────────┘
                 │ http over WireGuard (tailnet only, ACL-locked)
   ┌─────────────┼───────────────┬──────────────┐
   ▼             ▼               ▼              ▼
 rfs-agent     rfs-agent       rfs-agent      rfs-agent
 hub-box       laptop          gpu-box        desktop (windows)
 /, nvme0, sda all mounts      …              C:, D:
```

Two binaries, one Go module, one repo:

| Binary | Runs on | Does |
|---|---|---|
| `rfs-agent` | every machine | Enumerates mounts, serves `list / stat / read (range) / thumb / zip / upload` on the tailnet IP only. Authorizes callers via Tailscale LocalAPI `whois`. |
| `rfs-hub` | one machine | Serves the SPA, validates Cloudflare Access JWT, discovers agents from `tailscale status`, reverse-proxies file calls to the right agent, writes audit log. |

Discovery is free: hub asks local `tailscaled` for peers, probes `:7421` on each,
and anything answering is a machine in the UI. Adding a machine = install the agent.
No registration step, no config file.

### Why not X
- **Tailscale Funnel**: cannot serve a custom domain, TLS cert is for `*.ts.net`.
- **VPS reverse proxy**: works, costs money, you run TLS + auth yourself. Keep as
  plan B if Cloudflare's 100 MB request limit or ToS ever bites.
- **Sync (Syncthing/Nextcloud)**: duplicates terabytes. Not the ask.
- **Off-the-shelf (copyparty / Filebrowser per machine)**: covers 70% in an afternoon
  but no cross-machine view, no custom UI. If the UI is the point, build.

## 2. Public ingress, auth, 2FA

Move the domain's DNS to Cloudflare (free). Then:

1. `cloudflared tunnel` on the hub → `files.example.com` → `localhost:7420`.
   Outbound only. No port forwarding anywhere. TLS at the edge, HTTP/2+3 to clients.
   Nearest edge for Dhaka is the Dhaka PoP.
2. **Cloudflare Access** application on `files.example.com`:
   - Identity provider: Google.
   - Policy: allow only your own email (+ any others you list).
   - Require rule: login method = Google. Google's own 2-step verification is the
     second factor. Zero auth code written.
3. Hub re-verifies the `Cf-Access-Jwt-Assertion` header on every request using
   Cloudflare's JWKS (defense in depth: hub is useless even if someone reaches it
   without Access). Hub listens on `127.0.0.1:7420` and the tailnet IP only.
4. Phase 3 optional, in-app: WebAuthn passkey step-up before delete/upload.
   Step-up on destructive ops is more useful than a second login prompt.

## 3. Security measures (all of them are small)

| Threat | Measure |
|---|---|
| Path traversal, symlink escape | Go `os.OpenRoot` per mount root (stdlib, ≥1.24). Every path op goes through it. |
| Agent reachable by strangers | Binds tailnet IP only. Tailscale ACL: `tag:rfs-hub → tag:rfs-agent:7421`, nothing else. Agent also checks `whois` of the caller = hub node or your login. |
| Reading all drives needs root | Run agent as `rfs` user with `AmbientCapabilities=CAP_DAC_READ_SEARCH` + `NoNewPrivileges`. Read-everything, write-nothing, not root. Windows: run as SYSTEM service (no capability equivalent). |
| Accidental data loss | Writes are on from v1, but delete = move to `<root>/.rfs-trash/`, never `unlink`. `--readonly` flag per agent for machines that should never be written. |
| Leaking system internals | Skip `/proc /sys /dev /run /snap`, squashfs/tmpfs/overlay. Hidden by default, toggle in UI. |
| Who looked at what | Hub writes one JSON line per request: time, email, machine, path, bytes, status. |
| Secrets | Tunnel token in `/etc/rfs/hub.env` (0600, root). Nothing in the repo. |
| Supply chain | Go stdlib + 3 deps max (see §5). `go.sum` committed. |

## 4. Low latency

- **Fix the network first.** `tailscale ping kage` currently says relayed. Run
  `tailscale netcheck` on both ends; if UDP is blocked at campus, keep the `homelab`
  peer relay but put the hub where most data lives. Relay ≈ +40–80 ms per RTT,
  nothing in software beats fixing this.
- **Bytes take the shortest path.** Hub proxies with a keep-alive `http.Transport`
  pool to agents; agent serves files with `http.ServeContent` → `sendfile`.
  Range requests work out of the box, so video seeks are instant.
- **Thumbnails are made where the file is**, cached on that machine
  (`~/.cache/rfs/thumbs/<xxhash(path+mtime+size)>.webp`), served with
  `Cache-Control: immutable`. The grid never pulls full images. Images via Go
  `image` + `x/image/draw`; video first frame via `ffmpeg` if present.
- **Listings are cheap.** `os.ReadDir` + lazy `Lstat`, streamed as NDJSON so the
  UI paints the first rows before the directory finishes. Client caches with
  TanStack Query, prefetches on hover.
- **Search** (phase 2): each agent keeps an in-memory filename index built once
  with a background walk, kept fresh with `fsnotify`. Hub fans the query out in
  parallel, merges, returns in < 100 ms for ~5 M files.
- **Tailnet-direct fast path** (phase 3): if the browser can reach the hub's
  tailnet address, the SPA switches its API base to it and skips Cloudflare
  entirely. On the LAN that is a 1 ms path.

## 5. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Go ≥1.24, stdlib `net/http` | one static binary per OS, cross-compile for the Windows nodes, `os.OpenRoot`, `ServeContent` |
| Go deps | `tailscale.com/client/local` (whois, peers), `fsnotify`, `x/image` | nothing else |
| Frontend | Vite + React + TypeScript, Tailwind v4, TanStack Query + Virtual | large dirs need virtualisation; everything else is plain components |
| Media | native `<video>`/`<img>`, PDF via browser | no transcoding in v1; mkv/hevc show "download instead" |
| Deploy | `embed.FS` SPA inside `rfs-hub`; systemd units; `cloudflared` as a service | no Docker needed; keep it if you prefer |

## 6. UI design brief

Subject: your fleet of named machines (`atlas`, `nimbus`, `forge`, `relay`…) and the drives inside them. The vernacular is hardware: hostnames,
mount points, capacity, the amber activity LED on a drive bay. The UI should feel
like a quiet, well-lit server room, not a SaaS dashboard.

**Palette** (dark, chromatic graphite rather than tinted black)

| Token | Hex | Role |
|---|---|---|
| graphite | `#171A1F` | page |
| slate | `#21262E` | panels, rows on hover |
| bone | `#EDE8DF` | primary text |
| steel | `#8C97A8` | secondary text, icons |
| amber | `#F0B13B` | the one accent: online dot, activity LED, selection |
| ember | `#E2655A` | destructive, offline |

**Type**: IBM Plex Sans for everything, tabular numerals on. IBM Plex Mono only
where the content is a path or a hash. Scale 13 / 15 / 20 / 28 / 44.

**Layout** (left aligned throughout)

```
┌─────────────────────────────────────────────────────────────┐
│  laptop:/media/data/photos/2026              ⌘K  search ▮   │  path line, editable
├───────────┬─────────────────────────────────────┬───────────┤
│ fleet     │  name            size   modified    │ inspector │
│ ● atlas   │  ▸ raw/          —      Oct 12      │           │
│   / 468G  │  ▸ edits/        —      Oct 14      │ preview   │
│   nvme 915│    IMG_0411.jpg  4.2M   Oct 11      │ exif      │
│   sda 938G│    IMG_0412.jpg  4.1M   Oct 11      │ actions   │
│ ● hub-box │  …                                  │           │
│ ○ relay   │                                     │           │
└───────────┴─────────────────────────────────────┴───────────┘
```

- **Hero / landing** is the fleet: one row per machine, drives as thin capacity
  bars, online dot, last seen. No stats tiles, no gradient.
- **The memorable element** is the path line: a single editable
  `machine:/path` field that doubles as breadcrumb, address bar and jump box.
  Typing `nimbus:/home` moves machines. Tab completes.
- **Motion**: exactly one. The amber dot beside a machine pulses while bytes are
  flowing from it. Nothing fades in on scroll.
- Mobile: fleet collapses to a top chip row, inspector becomes a bottom sheet.
- Empty state says what to do: "No agents answered. Install one: `curl … | sh`."
- Errors name the cause: "kage is offline since 09:41." not "Something went wrong."

## 7. Phases, each with a pass/fail check

Each phase ends in a working, deployed thing. No phase starts before the previous
one's check passes.

**P0 — plumbing (½ day)**
- Install Go ≥1.24 on hub; move DNS to Cloudflare; create tunnel + Access app
  pointing at a hello-world on `:7420`.
- ✔ Opening `files.example.com` from a phone on mobile data shows Google login,
  then "hello", and the hub log shows your email from the JWT.

**P1 — browsing + upload on one machine (2–3 days)**
- `rfs-agent`: mounts, list (NDJSON), read with ranges, chunked upload, trash-delete,
  rename, `os.OpenRoot`, tailnet bind, whois check. `rfs-hub`: JWT verify,
  discover, proxy, embed SPA.
- SPA: fleet rail, listing with virtual scroll, path line, image/video/pdf preview.
- ✔ `go test ./...` has a traversal test (`../../etc/passwd` → 403) and a range
  test (`Range: bytes=10-19` → 10 bytes, 206).
- ✔ A 4 GB video on `sda` seeks in the browser over mobile data.

**P2 — fleet (1 day)**
- Install agent on every Linux node (systemd unit, install script) and the
  Windows nodes (service). Thumbnails. Zip-download of a folder. Audit log.
- ✔ All online tailnet machines appear within 10 s of the agent starting; a
  photo folder of 2 000 files paints its grid in < 1 s on second visit.

**P3 — write + search + fast path (2–3 days)**
- Filename search fan-out. Tailnet-direct API base. Optional passkey step-up for
  delete.
- ✔ Upload of a 2 GB file from the phone completes and resumes after airplane
  mode; search for `invoice` across 4 machines returns in < 200 ms on LAN.

## 8. Repo layout

```
rfs/
  go.mod
  cmd/agent/main.go       cmd/hub/main.go
  internal/agent/         mounts.go list.go serve.go thumb.go auth.go
  internal/hub/           access.go discover.go proxy.go audit.go
  web/                    vite + react; `npm run build` → hub embeds web/dist
  deploy/                 rfs-agent.service rfs-hub.service install.sh cloudflared.yml
  PLAN.md
```

## 9. Decisions (settled 2026-10-19)

- Ingress: Cloudflare Tunnel + Access. Hostname `files.example.com`.
- Hub: `hub-box`.
- Write access on from v1, trash-delete everywhere.
- Stack: Go + React.
