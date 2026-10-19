# Security

rfs exposes every drive of every machine you install an agent on. Read this before you deploy it.

## Threat model

| Layer | Control |
|---|---|
| Public ingress | Only through a Cloudflare Tunnel. No machine opens an inbound port. Cloudflare Access enforces your identity provider (Google and so on) and an email allowlist at the edge. |
| Hub | Re-verifies the Cloudflare Access JWT on every request against your team's JWKS. Without a valid token the hub answers 403 for everything except `/healthz`. The hub binds loopback only. |
| Hub to agent | Plain HTTP over the WireGuard tailnet. Agents bind the tailnet IP only and accept callers whose Tailscale identity (via the local `whois` API) is the same tailnet user that owns the agent machine. Other users' nodes on a shared tailnet are rejected. |
| Paths | Every file operation goes through `os.OpenRoot` of a mounted drive, so `..` and symlink escapes fail. `/proc`, `/sys`, `/dev` and `/run` are never served. `-mounts` restricts an agent to named directories. |
| Deletion | Delete moves to a per-drive trash folder; nothing is unlinked unless you delete from inside the trash. `-readonly` disables all writes on an agent. |
| Privilege | The Linux system unit runs as an unprivileged user with `CAP_DAC_READ_SEARCH` (and `CAP_DAC_OVERRIDE` for writes) instead of root. |

## What is deliberately out of scope

- No application-level users or sharing links. One owner, authenticated by Access.
- No rate limiting. Access is the only thing between the internet and the hub.
- Thumbnails shell out to `ffmpeg` for video. Keep ffmpeg updated; the agent only ever passes paths it resolved itself.

## Deployment hygiene

- Keep `~/.config/rfs/hub.env` (tunnel token, Access audience) at mode 600. Never commit it; `.gitignore` excludes `*.env`.
- The `-dev-email` flag disables authentication and is refused on any non-loopback bind. Never pass it to a service unit.
- The `-demo-fleet` flag serves a fake machine list for screenshots and should not run alongside a production hub.

## Reporting

Open a private security advisory on GitHub or email the maintainer listed in the repository profile. Please do not file public issues for vulnerabilities.
