# Security

rfs exposes every drive of every machine you install an agent on. Read this before you deploy it.

## Threat model

| Layer | Control |
|---|---|
| Public ingress | Only through a Cloudflare Tunnel. No machine opens an inbound port. Cloudflare Access enforces your identity provider (Google and so on) and an email allowlist at the edge. |
| Hub | Re-verifies the Cloudflare Access JWT on every request against your team's JWKS. Without a valid token the hub answers 403 for everything except `/healthz`. The hub binds loopback only. |
| Hub to agent | Plain HTTP over the WireGuard tailnet. Agents bind the tailnet IP only and accept callers whose Tailscale identity (via the local `whois` API) is the same tailnet user that owns the agent machine. Other users' nodes on a shared tailnet are rejected. |
| Second factor | Optional TOTP owned by the hub, independent of the identity provider. Once enrolled from Security settings, each browser must enter a code; a signed, user-bound cookie remembers the device for 30 days. Codes are single-use with a flat per-attempt delay. |
| Per-machine password | Optional access password per agent, set on that machine with `rfs-agent -set-password` (PBKDF2-SHA256, 600k iterations, file mode 600). The hub never sees the hash; a correct password yields a 12-hour token the hub attaches to requests for that machine. Wrong attempts back off per caller. Only the drive list is visible without it. |
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
