# Mobile App

Next.js mobile-first PWA for sending commands, viewing live logs, and approving file changes.

## Features

- Chat-style command input
- Repository selector
- Live terminal log panel via WebSocket
- Approval modal with file list + diff preview
- Task history screen
- PWA manifest + service worker registration

## Run

```bash
cd mobile-app
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000` and from phone use your computer's LAN IP, for example:

`http://192.168.1.10:3000`

Use browser "Add to Home Screen" to install.

## Environment

- `NEXT_PUBLIC_BACKEND_HTTP_URL`: backend API URL
- `NEXT_PUBLIC_BACKEND_WS_URL`: backend WS URL
- `NEXT_PUBLIC_DEVICE_TOKEN`: auth token shared with backend/agent
