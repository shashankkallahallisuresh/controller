"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createTask, fetchRepositories, fetchTasks, submitApproval } from "../lib/api";
import { useMobileSocket } from "../lib/ws";
import { ApprovalRequest, Repository, Task, TaskLog } from "../lib/types";

function formatTime(iso?: string) {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatScreen() {
  const [command, setCommand] = useState("");
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Record<string, TaskLog[]>>({});
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [editedCommand, setEditedCommand] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  const activeTask = useMemo(
    () =>
      tasks.find((task) => task.status === "running" || task.status === "awaiting_approval") ??
      tasks[0],
    [tasks]
  );

  const activeLogs = useMemo(() => {
    if (!activeTask) return [];
    return logs[activeTask.id] || [];
  }, [activeTask, logs]);

  useEffect(() => {
    fetchRepositories().then((list) => {
      setRepos(list);
      if (list[0]) setSelectedRepo(list[0].path);
    });
    fetchTasks().then(setTasks);
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [activeLogs]);

  useMobileSocket((event) => {
    if (event.type === "tasks.snapshot" && event.payload?.tasks) {
      setTasks(event.payload.tasks);
      return;
    }
    if (event.type === "task.created" || event.type === "task.updated") {
      const incoming = event.payload as Task;
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === incoming.id);
        if (idx === -1) return [incoming, ...prev];
        const copy = [...prev];
        copy[idx] = incoming;
        return copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      });
      return;
    }
    if (event.type === "task.log") {
      const log = event.payload as TaskLog;
      setLogs((prev) => ({
        ...prev,
        [log.taskId]: [...(prev[log.taskId] || []), log].slice(-400)
      }));
      return;
    }
    if (event.type === "task.approval.request") {
      setApproval(event.payload as ApprovalRequest);
      setEditedCommand("");
    }
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!command.trim() || !selectedRepo || submitting) return;
    setSubmitting(true);
    try {
      await createTask(command.trim(), selectedRepo);
      setCommand("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit task");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApproval(decision: "approve" | "reject" | "edit") {
    if (!approval) return;
    try {
      await submitApproval(approval.taskId, decision, editedCommand || undefined);
      setApproval(null);
      setEditedCommand("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit approval");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col p-4 text-slate-100">
      <header className="mb-3 rounded-2xl border border-slate-800/60 bg-card p-4 shadow-panel">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Claude Remote</h1>
          <Link className="text-sm text-accent hover:text-blue-300" href="/history">
            History
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted">Control Claude Code from your phone</p>
        <label className="mt-3 block text-xs text-slate-300">Repository</label>
        <select
          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/80 p-2 text-sm"
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
        >
          {repos.map((repo) => (
            <option key={repo.id} value={repo.path}>
              {repo.label}
            </option>
          ))}
        </select>
      </header>

      <section className="mb-3 rounded-2xl border border-slate-800/60 bg-card p-3 shadow-panel">
        <p className="text-xs uppercase tracking-wide text-muted">Command Chat</p>
        <div className="mt-2 space-y-2">
          <div className="ml-auto max-w-[88%] rounded-2xl bg-accent/20 p-3 text-sm text-slate-100">
            {activeTask?.command || "Send your first command."}
          </div>
          <div className="max-w-[92%] rounded-2xl bg-slate-900 p-3 text-sm text-slate-300">
            {activeTask?.status === "running" || activeTask?.status === "awaiting_approval"
              ? "Claude Code is working..."
              : "Idle"}
          </div>
        </div>
      </section>

      <section className="mb-3 flex min-h-[240px] flex-1 flex-col rounded-2xl border border-slate-800/60 bg-slate-950/70 p-3 shadow-panel">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted">Live Execution Logs</p>
          <span className="text-xs text-slate-400">{activeTask ? activeTask.status : "no task"}</span>
        </div>
        <div ref={terminalRef} className="terminal-scroll flex-1 overflow-auto font-mono text-xs leading-5">
          {activeLogs.length === 0 ? (
            <p className="text-slate-500">No logs yet.</p>
          ) : (
            activeLogs.map((log, idx) => (
              <p key={`${log.timestamp}-${idx}`} className="whitespace-pre-wrap text-slate-200">
                [{formatTime(log.timestamp)}] {log.line}
              </p>
            ))
          )}
        </div>
      </section>

      <form onSubmit={onSubmit} className="sticky bottom-3 rounded-2xl border border-slate-700 bg-card p-3 shadow-panel">
        <div className="flex items-end gap-2">
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Fix failing tests in payment module..."
            className="h-20 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900/80 p-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            className="h-10 w-10 rounded-xl border border-slate-600 bg-slate-800 text-sm text-slate-300"
            title="Microphone (placeholder)"
            aria-label="Microphone placeholder"
          >
            Mic
          </button>
        </div>
        <button
          disabled={!selectedRepo || !command.trim() || submitting}
          className="mt-2 w-full rounded-xl bg-gradient-to-r from-accent to-accent2 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          type="submit"
        >
          {submitting ? "Sending..." : "Send Command"}
        </button>
      </form>

      {approval && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/65 p-3">
          <div className="w-full rounded-2xl border border-slate-700 bg-card p-4 shadow-panel">
            <p className="text-sm font-semibold text-red-300">Approval Required</p>
            <p className="mt-1 text-xs text-slate-300">{approval.message}</p>
            <p className="mt-3 text-xs text-slate-400">Files to modify:</p>
            <div className="mt-1 max-h-20 overflow-auto rounded-lg bg-slate-900 p-2 text-xs">
              {approval.files.map((f) => (
                <p key={f}>{f}</p>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">Diff preview:</p>
            <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-slate-950 p-2 font-mono text-[11px] text-slate-200">
              {approval.diff || "(no diff preview)"}
            </pre>
            <textarea
              value={editedCommand}
              onChange={(e) => setEditedCommand(e.target.value)}
              placeholder="Optional edited command"
              className="mt-2 h-16 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs"
            />
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <button
                type="button"
                className="rounded-lg bg-emerald-600 px-2 py-2 font-semibold text-white"
                onClick={() => handleApproval("approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-2 py-2 font-semibold text-white"
                onClick={() => handleApproval("reject")}
              >
                Reject
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-2 py-2 font-semibold text-white"
                onClick={() => handleApproval("edit")}
              >
                Edit Cmd
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
