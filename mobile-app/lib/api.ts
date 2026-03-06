import { Repository, Task } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL || "http://localhost:8080";
const TOKEN = process.env.NEXT_PUBLIC_DEVICE_TOKEN || "change-me";

async function call<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(options?.headers || {})
    },
    cache: "no-store"
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchRepositories(): Promise<Repository[]> {
  const data = await call<{ repositories: Repository[] }>("/api/repositories");
  return data.repositories;
}

export async function fetchTasks(): Promise<Task[]> {
  const data = await call<{ tasks: Task[] }>("/api/tasks");
  return data.tasks;
}

export async function createTask(command: string, repoPath: string): Promise<Task> {
  const data = await call<{ task: Task }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ command, repoPath })
  });
  return data.task;
}

export async function submitApproval(
  taskId: string,
  decision: "approve" | "reject" | "edit",
  editedCommand?: string
) {
  await call(`/api/tasks/${taskId}/approval`, {
    method: "POST",
    body: JSON.stringify({ decision, editedCommand })
  });
}
