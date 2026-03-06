# PC Agent

Python service running on the developer machine. It executes Claude Code CLI, streams logs, and pauses for approval when file changes are detected.

## Run

```bash
cd pc-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python agent.py
```

## Environment

- `BACKEND_WS_URL`: backend websocket endpoint
- `DEVICE_TOKEN`: shared auth token
- `AGENT_ID`: unique agent id
- `CLAUDE_BIN`: Claude Code CLI binary (`claude-code`)
- `CLAUDE_ARGS`: optional CLI args
- `REPOSITORIES`: allowed repo paths for this agent
- `CHANGE_POLL_INTERVAL`: git change detection interval
- `DIFF_PREVIEW_MAX_CHARS`: approval diff preview limit
