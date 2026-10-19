# Contributing

Small, focused pull requests are welcome.

- Backend: Go 1.24+, standard library first. Run `go vet ./... && go test ./...`.
- Frontend: `cd web && npm ci && npm run build`. The hub embeds `web/dist`, so build the UI before building the hub.
- End-to-end: needs a running agent on this machine and a dev hub: `./bin/rfs-hub -addr 127.0.0.1:7430 -dev-email you@example.com`, then `cd web && npx playwright test`.
- Palette changes go through `web/src/palette.json`, applied with `node scripts/apply-palette.mjs src/palette.json` and checked with `node scripts/check-palette.mjs`.
- Keep the vocabulary: rack, unit, bay, drive, LED. No emoji icons.
