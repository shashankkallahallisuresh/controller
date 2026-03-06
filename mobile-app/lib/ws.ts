"use client";

import { useEffect, useRef } from "react";

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8080/ws";
const TOKEN = process.env.NEXT_PUBLIC_DEVICE_TOKEN || "change-me";

export function useMobileSocket(onMessage: (msg: any) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let ws: WebSocket | undefined;
    let retryTimer: number | undefined;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: "auth",
            payload: { role: "mobile", token: TOKEN }
          })
        );
      };
      ws.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data));
        } catch {
          // ignore malformed event
        }
      };
      ws.onclose = () => {
        retryTimer = window.setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
