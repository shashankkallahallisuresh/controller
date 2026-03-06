import asyncio
import json
import os
import shlex
import signal
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

import websockets
from dotenv import load_dotenv

load_dotenv()

BACKEND_WS_URL = os.getenv("BACKEND_WS_URL", "ws://localhost:8080/ws")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", "change-me")
AGENT_ID = os.getenv("AGENT_ID", "pc-agent-1")
CLAUDE_BIN = os.getenv("CLAUDE_BIN", "claude-code")
CLAUDE_ARGS = shlex.split(os.getenv("CLAUDE_ARGS", ""))
REPOSITORIES = [r.strip() for r in os.getenv("REPOSITORIES", "").split(",") if r.strip()]
CHANGE_POLL_INTERVAL = float(os.getenv("CHANGE_POLL_INTERVAL", "1.5"))
DIFF_PREVIEW_MAX_CHARS = int(os.getenv("DIFF_PREVIEW_MAX_CHARS", "12000"))


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_git(repo_path: str, args: List[str]) -> str:
    try:
        out = subprocess.check_output(
            ["git", "-C", repo_path, *args],
            stderr=subprocess.STDOUT,
            text=True,
        )
        return out
    except subprocess.CalledProcessError as exc:
        return exc.output or ""


def changed_files(repo_path: str) -> Set[str]:
    status = run_git(repo_path, ["status", "--porcelain"])
    files: Set[str] = set()
    for line in status.splitlines():
        if len(line) < 4:
            continue
        files.add(line[3:].strip())
    return files


def diff_for_files(repo_path: str, files: List[str]) -> str:
    if not files:
        return ""
    output = run_git(repo_path, ["diff", "--", *files])
    if len(output) > DIFF_PREVIEW_MAX_CHARS:
        return output[:DIFF_PREVIEW_MAX_CHARS] + "\n\n...diff truncated..."
    return output


@dataclass
class ApprovalResult:
    decision: str
    edited_command: Optional[str] = None


class Agent:
    def __init__(self):
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.approval_waiters: Dict[str, asyncio.Future] = {}
        self.running_tasks: Dict[str, asyncio.Task] = {}

    async def send(self, message: dict):
        if not self.ws:
            return
        await self.ws.send(json.dumps(message))

    async def send_log(self, task_id: str, line: str, level: str = "info"):
        await self.send(
            {
                "type": "task.log",
                "payload": {
                    "taskId": task_id,
                    "line": line,
                    "level": level,
                    "timestamp": iso_now(),
                },
            }
        )

    async def send_status(
        self,
        task_id: str,
        status: str,
        error: Optional[str] = None,
        files_modified: Optional[List[str]] = None,
    ):
        payload = {"taskId": task_id, "status": status}
        if error:
            payload["error"] = error
        if files_modified is not None:
            payload["filesModified"] = files_modified
        await self.send({"type": "task.status", "payload": payload})

    async def wait_for_approval(self, task_id: str) -> ApprovalResult:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self.approval_waiters[task_id] = fut
        result = await fut
        return result

    async def handle_approval_response(self, payload: dict):
        task_id = payload.get("taskId")
        if not task_id or task_id not in self.approval_waiters:
            return
        decision = payload.get("decision", "reject")
        edited_command = payload.get("editedCommand")
        waiter = self.approval_waiters.pop(task_id)
        waiter.set_result(ApprovalResult(decision=decision, edited_command=edited_command))

    async def monitor_changes(
        self,
        task_id: str,
        repo_path: str,
        proc: asyncio.subprocess.Process,
        baseline_changes: Set[str],
    ) -> Optional[ApprovalResult]:
        approval_sent = False
        while proc.returncode is None:
            await asyncio.sleep(CHANGE_POLL_INTERVAL)
            current = changed_files(repo_path)
            new_files = sorted(list(current.difference(baseline_changes)))
            if approval_sent or not new_files:
                continue

            approval_sent = True
            can_pause = hasattr(signal, "SIGSTOP") and proc.pid is not None
            if can_pause:
                os.kill(proc.pid, signal.SIGSTOP)
            diff_text = diff_for_files(repo_path, new_files)
            await self.send(
                {
                    "type": "task.approval.request",
                    "payload": {
                        "taskId": task_id,
                        "files": new_files,
                        "diff": diff_text,
                        "message": "Claude Code changed files and is paused for approval.",
                    },
                }
            )
            await self.send_log(task_id, "Execution paused pending approval.")

            approval = await self.wait_for_approval(task_id)
            if approval.decision == "approve":
                await self.send_log(task_id, "Approval received. Resuming task.")
                if can_pause:
                    os.kill(proc.pid, signal.SIGCONT)
                return approval
            if approval.decision == "edit":
                await self.send_log(task_id, "Edit requested. Stopping current task.", "warn")
                proc.terminate()
                return approval
            await self.send_log(task_id, "Changes rejected. Terminating task.", "warn")
            proc.terminate()
            return approval

        return None

    async def stream_output(self, task_id: str, stream, level: str):
        while True:
            line = await stream.readline()
            if not line:
                break
            await self.send_log(task_id, line.decode(errors="replace").rstrip(), level)

    async def execute_task(self, payload: dict):
        task_id = payload["id"]
        command = payload["command"]
        repo_path = payload["repoPath"]
        started = time.time()
        await self.send_log(task_id, f"[{iso_now()}] Starting Claude Code")
        await self.send_log(task_id, f"Repository: {repo_path}")
        await self.send_log(task_id, f"Prompt: {command}")

        if REPOSITORIES and repo_path not in REPOSITORIES:
            await self.send_status(task_id, "failed", f"Repo not allowed on this agent: {repo_path}")
            return

        baseline_changes = changed_files(repo_path)
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN,
            *CLAUDE_ARGS,
            command,
            cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout_task = asyncio.create_task(self.stream_output(task_id, proc.stdout, "info"))
        stderr_task = asyncio.create_task(self.stream_output(task_id, proc.stderr, "error"))
        change_monitor_task = asyncio.create_task(
            self.monitor_changes(task_id, repo_path, proc, baseline_changes)
        )

        await proc.wait()
        await stdout_task
        await stderr_task
        approval_result = await change_monitor_task

        duration = round(time.time() - started, 2)
        files_modified = sorted(list(changed_files(repo_path).difference(baseline_changes)))

        if approval_result and approval_result.decision == "reject":
            await self.send_status(task_id, "rejected", "Rejected from mobile approval", files_modified)
            return
        if approval_result and approval_result.decision == "edit":
            edited = approval_result.edited_command or ""
            await self.send_status(
                task_id,
                "failed",
                f"Task stopped for edited command request: {edited}",
                files_modified,
            )
            return

        if proc.returncode == 0:
            await self.send_log(task_id, f"Task finished in {duration}s")
            await self.send_status(task_id, "completed", files_modified=files_modified)
        else:
            await self.send_status(
                task_id,
                "failed",
                f"Claude Code exited with code {proc.returncode}",
                files_modified,
            )

    async def connect_and_run(self):
        while True:
            try:
                async with websockets.connect(BACKEND_WS_URL, max_size=2**22) as ws:
                    self.ws = ws
                    await self.send(
                        {
                            "type": "auth",
                            "payload": {
                                "role": "agent",
                                "token": DEVICE_TOKEN,
                                "agentId": AGENT_ID,
                                "repositories": REPOSITORIES,
                            },
                        }
                    )
                    async for raw in ws:
                        msg = json.loads(raw)
                        msg_type = msg.get("type")
                        payload = msg.get("payload", {})

                        if msg_type == "task.assigned":
                            task_id = payload.get("id")
                            if not task_id:
                                continue
                            task = asyncio.create_task(self.execute_task(payload))
                            self.running_tasks[task_id] = task
                            task.add_done_callback(
                                lambda _, task_id=task_id: self.running_tasks.pop(task_id, None)
                            )
                        elif msg_type == "task.approval.response":
                            await self.handle_approval_response(payload)
            except Exception as exc:
                print(f"[agent] connection error: {exc}")
                await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(Agent().connect_and_run())
