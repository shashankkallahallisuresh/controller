"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTasks } from "../../lib/api";
import { Task } from "../../lib/types";

function formatDuration(ms?: number) {
  if (!ms || ms < 0) return "--";
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function HistoryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4 text-slate-100">
      <header className="mb-4 rounded-2xl border border-slate-800/60 bg-card p-4 shadow-panel">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Task History</h1>
          <Link className="text-sm text-accent" href="/">
            Back
          </Link>
        </div>
      </header>

      <section className="space-y-3">
        {tasks.map((task) => (
          <article key={task.id} className="rounded-xl border border-slate-800 bg-card p-3">
            <p className="text-sm font-medium text-slate-100">{task.command}</p>
            <p className="mt-1 text-xs text-slate-400">{task.repoPath}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-slate-700 px-2 py-1">{task.status}</span>
              <span className="rounded-full border border-slate-700 px-2 py-1">
                {formatDuration(task.durationMs)}
              </span>
              <span className="rounded-full border border-slate-700 px-2 py-1">
                {task.filesModified.length} files
              </span>
            </div>
            {task.filesModified.length > 0 && (
              <div className="mt-2 rounded-lg bg-slate-900 p-2 text-xs text-slate-300">
                {task.filesModified.join(", ")}
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
