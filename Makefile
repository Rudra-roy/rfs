.PHONY: web build test agent-windows demo capture
web:            ## build the SPA (embedded by the hub)
	cd web && npm ci && npm run build
build: web      ## build hub and agent for this machine
	go build -o bin/rfs-hub ./cmd/hub && go build -o bin/rfs-agent ./cmd/agent
test:           ## unit tests and UI typecheck
	go vet ./... && go test ./... && cd web && npm run typecheck
agent-windows:  ## cross-compile the agent for Windows nodes
	GOOS=windows GOARCH=amd64 go build -o bin/rfs-agent.exe ./cmd/agent
demo:           ## synthetic fleet on http://127.0.0.1:7440 (no auth, fake machines)
	scripts/demo/run.sh
capture: demo   ## README screenshots and demo.gif from the demo fleet
	cd web && node scripts/capture.mjs
