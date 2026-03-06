export type TaskStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "rejected";

export type Task = {
  id: string;
  command: string;
  repoPath: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  filesModified: string[];
  error?: string;
};

export type Repository = {
  id: string;
  path: string;
  label: string;
};

export type ApprovalRequest = {
  taskId: string;
  files: string[];
  diff: string;
  message: string;
};

export type TaskLog = {
  taskId: string;
  line: string;
  level: string;
  timestamp: string;
};
