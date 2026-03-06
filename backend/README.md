# Backend

Express API + WebSocket broker for mobile clients and PC agents.

## Features

- Token auth for HTTP + WebSocket
- Repository allowlist
- Task queue + status tracking
- Live log fanout to mobile clients
- Approval request/response routing

## Run

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

## Environment

- `PORT`: API port (`8080`)
- `DEVICE_TOKEN`: shared secret used by mobile app and agent
- `ALLOWED_ORIGINS`: comma-separated web origins for CORS
- `ALLOWED_REPOS`: comma-separated absolute repo paths

## API

- `GET /health`
- `GET /api/repositories`
- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/tasks/:taskId/approval`

Auth header for API routes:

`Authorization: Bearer <DEVICE_TOKEN>`
