import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { v4 as uuid } from "uuid";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";

dotenv.config();

type TaskStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "rejected";

type Task = {
  id: string;
  command: string;
  repoPath: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  agentId?: string;
  error?: string;
  filesModified: string[];
};

type AgentConn = {
  id: string;
  ws: WebSocket;
  busy: boolean;
  repositories: string[];
  currentTaskId?: string;
  connectedAt: string;
};

const port = Number(process.env.PORT || 8080);
const deviceToken = process.env.DEVICE_TOKEN || "change-me";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const allowedRepos = (process.env.ALLOWED_REPOS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: false
  })
);

const tasks = new Map<string, Task>();
const queue: string[] = [];
const agents = new Map<string, AgentConn>();
const mobileSockets = new Set<WebSocket>();

function isTokenValid(token?: string): boolean {
  return !!token && token === deviceToken;
}

function nowIso() {
  return new Date().toISOString();
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToMobiles(payload: unknown) {
  for (const ws of mobileSockets) safeSend(ws, payload);
}

function pickAgentForRepo(repoPath: string): AgentConn | undefined {
  for (const agent of agents.values()) {
    const repoAllowed = agent.repositories.length === 0 || agent.repositories.includes(repoPath);
    if (!agent.busy && repoAllowed) return agent;
  }
  return undefined;
}

function dispatchQueue() {
  if (!queue.length) return;

  for (let i = 0; i < queue.length; i += 1) {
    const taskId = queue[i];
    const task = tasks.get(taskId);
    if (!task || task.status !== "queued") {
      queue.splice(i, 1);
      i -= 1;
      continue;
    }

    const agent = pickAgentForRepo(task.repoPath);
    if (!agent) continue;

    agent.busy = true;
    agent.currentTaskId = task.id;
    task.status = "running";
    task.startedAt = nowIso();
    task.agentId = agent.id;
    queue.splice(i, 1);

    safeSend(agent.ws, {
      type: "task.assigned",
      payload: {
        id: task.id,
        command: task.command,
        repoPath: task.repoPath,
        createdAt: task.createdAt
      }
    });
    broadcastToMobiles({ type: "task.updated", payload: task });
    i -= 1;
  }
}

function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader?.startsWith("Bearer ")) return undefined;
  return authorizationHeader.replace("Bearer ", "").trim();
}

const taskCreateSchema = z.object({
  command: z.string().min(3).max(4000),
  repoPath: z.string().min(1)
});

const commandDenyList = ["rm -rf /", ":(){ :|:& };:"];

function validateCommand(command: string): string | null {
  const normalized = command.toLowerCase();
  for (const banned of commandDenyList) {
    if (normalized.includes(banned)) {
      return `Command blocked by policy: ${banned}`;
    }
  }
  return null;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    agents: Array.from(agents.values()).map((a) => ({
      id: a.id,
      busy: a.busy,
      repositories: a.repositories,
      connectedAt: a.connectedAt,
      currentTaskId: a.currentTaskId
    })),
    queued: queue.length
  });
});

app.get("/api/repositories", (req, res) => {
  const token = getBearerToken(req.header("authorization"));
  if (!isTokenValid(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.json({
    repositories: allowedRepos.map((path) => ({
      id: path,
      path,
      label: path.split("/").filter(Boolean).slice(-2).join("/")
    }))
  });
});

app.get("/api/tasks", (req, res) => {
  const token = getBearerToken(req.header("authorization"));
  if (!isTokenValid(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const list = Array.from(tasks.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return res.json({ tasks: list });
});

app.post("/api/tasks", (req, res) => {
  const token = getBearerToken(req.header("authorization"));
  if (!isTokenValid(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = taskCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { command, repoPath } = parsed.data;
  if (allowedRepos.length > 0 && !allowedRepos.includes(repoPath)) {
    return res.status(400).json({ error: "Repository is not in allowlist" });
  }
  const blockedReason = validateCommand(command);
  if (blockedReason) return res.status(400).json({ error: blockedReason });

  const task: Task = {
    id: uuid(),
    command,
    repoPath,
    status: "queued",
    createdAt: nowIso(),
    filesModified: []
  };
  tasks.set(task.id, task);
  queue.push(task.id);

  broadcastToMobiles({ type: "task.created", payload: task });
  dispatchQueue();

  return res.status(202).json({ task });
});

const approvalSchema = z.object({
  decision: z.enum(["approve", "reject", "edit"]),
  editedCommand: z.string().max(4000).optional()
});

app.post("/api/tasks/:taskId/approval", (req, res) => {
  const token = getBearerToken(req.header("authorization"));
  if (!isTokenValid(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!task.agentId) return res.status(409).json({ error: "Task has no assigned agent" });

  const agent = agents.get(task.agentId);
  if (!agent) return res.status(409).json({ error: "Agent is not connected" });

  safeSend(agent.ws, {
    type: "task.approval.response",
    payload: {
      taskId: task.id,
      decision: parsed.data.decision,
      editedCommand: parsed.data.editedCommand
    }
  });

  return res.json({ ok: true });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const authSchema = z.object({
  type: z.literal("auth"),
  payload: z.object({
    role: z.enum(["mobile", "agent"]),
    token: z.string(),
    agentId: z.string().optional(),
    repositories: z.array(z.string()).optional()
  })
});

wss.on("connection", (ws) => {
  let role: "mobile" | "agent" | undefined;
  let agentId: string | undefined;

  const authTimeout = setTimeout(() => {
    safeSend(ws, { type: "error", payload: { message: "Auth timeout" } });
    ws.close();
  }, 5000);

  ws.on("message", (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, { type: "error", payload: { message: "Invalid JSON" } });
      return;
    }

    if (!role) {
      const parsed = authSchema.safeParse(message);
      if (!parsed.success || !isTokenValid(parsed.data.payload.token)) {
        safeSend(ws, { type: "error", payload: { message: "Unauthorized" } });
        ws.close();
        return;
      }

      clearTimeout(authTimeout);
      role = parsed.data.payload.role;

      if (role === "mobile") {
        mobileSockets.add(ws);
        safeSend(ws, {
          type: "auth.ok",
          payload: { role: "mobile", serverTime: nowIso() }
        });
        safeSend(ws, {
          type: "tasks.snapshot",
          payload: {
            tasks: Array.from(tasks.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          }
        });
        return;
      }

      agentId = parsed.data.payload.agentId || `agent-${uuid().slice(0, 8)}`;
      agents.set(agentId, {
        id: agentId,
        ws,
        busy: false,
        repositories: parsed.data.payload.repositories || allowedRepos,
        connectedAt: nowIso()
      });
      safeSend(ws, { type: "auth.ok", payload: { role: "agent", agentId } });
      dispatchQueue();
      return;
    }

    if (role === "agent" && agentId) {
      const envelope = z
        .object({
          type: z.string(),
          payload: z.record(z.unknown()).optional()
        })
        .safeParse(message);

      if (!envelope.success) return;

      const eventType = envelope.data.type;
      const payload = envelope.data.payload || {};
      const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
      const task = taskId ? tasks.get(taskId) : undefined;

      if (eventType === "task.log" && task) {
        broadcastToMobiles({
          type: "task.log",
          payload: {
            taskId,
            level: payload.level || "info",
            line: payload.line || "",
            timestamp: payload.timestamp || nowIso()
          }
        });
        return;
      }

      if (eventType === "task.approval.request" && task) {
        task.status = "awaiting_approval";
        broadcastToMobiles({
          type: "task.updated",
          payload: task
        });
        broadcastToMobiles({
          type: "task.approval.request",
          payload: {
            taskId,
            files: Array.isArray(payload.files) ? payload.files : [],
            diff: typeof payload.diff === "string" ? payload.diff : "",
            message: typeof payload.message === "string" ? payload.message : "Approval required"
          }
        });
        return;
      }

      if (eventType === "task.status" && task) {
        const status = payload.status;
        if (typeof status === "string") task.status = status as TaskStatus;
        if (typeof payload.error === "string") task.error = payload.error;
        if (Array.isArray(payload.filesModified)) {
          task.filesModified = payload.filesModified.filter((x): x is string => typeof x === "string");
        }
        if (task.status === "completed" || task.status === "failed" || task.status === "rejected") {
          task.completedAt = nowIso();
          if (task.startedAt) {
            task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
          }
          const agent = agents.get(task.agentId || "");
          if (agent) {
            agent.busy = false;
            agent.currentTaskId = undefined;
          }
          dispatchQueue();
        }
        broadcastToMobiles({
          type: "task.updated",
          payload: task
        });
      }
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimeout);
    if (role === "mobile") {
      mobileSockets.delete(ws);
      return;
    }
    if (role === "agent" && agentId) {
      const agent = agents.get(agentId);
      if (agent?.currentTaskId) {
        const task = tasks.get(agent.currentTaskId);
        if (task && (task.status === "running" || task.status === "awaiting_approval")) {
          task.status = "failed";
          task.error = "Agent disconnected";
          task.completedAt = nowIso();
          if (task.startedAt) {
            task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
          }
          broadcastToMobiles({ type: "task.updated", payload: task });
        }
      }
      agents.delete(agentId);
      dispatchQueue();
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`WebSocket endpoint ws://localhost:${port}/ws`);
});
