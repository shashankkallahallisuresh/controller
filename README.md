# Claude Code Remote Controller

Complete app to control Claude Code on your PC from your phone.

Architecture:

`Phone -> Backend API -> PC Agent -> Claude Code CLI -> Logs/Approvals -> Phone`

## Folder Structure

```text
.
├── mobile-app   # Next.js + Tailwind mobile-first PWA
├── backend      # Express API + WebSocket server + task queue
└── pc-agent     # Python agent that runs Claude Code locally
```

## Core Features Implemented

- Mobile chat-style command UI
- Live execution logs streamed via WebSocket
- Approval request flow with file list and diff preview
- Task history view (status, duration, files modified)
- Repository selector
- Python PC agent with subprocess execution (`claude-code`)
- Basic security: shared device token auth, command denylist, repo allowlist

## 1) Run Backend

```bash
cd backend
npm install
cp .env.example .env
```

Set values in `backend/.env`:

- `DEVICE_TOKEN` (same token in all components)
- `ALLOWED_REPOS` (absolute paths, comma-separated)
- `ALLOWED_ORIGINS` (mobile-app origin, e.g. `http://localhost:3000`)

Start:

```bash
npm run dev
```

Server endpoints:

- HTTP: `http://localhost:8080`
- WS: `ws://localhost:8080/ws`

## 2) Start PC Agent

```bash
cd pc-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set values in `pc-agent/.env`:

- `BACKEND_WS_URL=ws://localhost:8080/ws`
- `DEVICE_TOKEN=<same token>`
- `REPOSITORIES=<same allowed repo paths>`
- `CLAUDE_BIN=claude-code`

Run:

```bash
python agent.py
```

## 3) Open Mobile UI

```bash
cd mobile-app
npm install
cp .env.example .env.local
```

Set values in `mobile-app/.env.local`:

- `NEXT_PUBLIC_BACKEND_HTTP_URL=http://localhost:8080`
- `NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8080/ws`
- `NEXT_PUBLIC_DEVICE_TOKEN=<same token>`

Run:

```bash
npm run dev
```

Open on phone via your computer LAN IP, example:

`http://192.168.1.10:3000`

Install as PWA: browser menu -> `Add to Home Screen`.

## 4) Connect Device + Send First Command

1. Confirm backend is running.
2. Confirm agent terminal shows connected state (no reconnect errors).
3. Open mobile app, select repository.
4. Send command:
   `Fix failing tests in the payment module`
5. Watch live logs stream in the terminal panel.
6. When approval appears, review diff and choose:
   `Approve`, `Reject`, or `Edit Cmd`.

## Example Workflow

1. User sends command from phone.
2. Backend queues task and assigns connected agent.
3. Agent starts Claude Code CLI in selected repo.
4. Agent streams stdout/stderr log lines over WebSocket.
5. If file changes are detected, agent pauses process and sends approval request with diff.
6. User approves/rejects/edits on phone.
7. Agent resumes or stops accordingly and sends final status.

## Security Notes

- Device authentication token required for both API and WebSocket auth.
- Repository allowlist restricts where tasks can run.
- Basic command validation blocks known dangerous patterns.
- Use TLS in production (`https`/`wss`) via reverse proxy.
