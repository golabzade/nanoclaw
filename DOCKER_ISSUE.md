# NanoClaw Docker Maintenance & Troubleshooting

This document serves as a guide for maintaining the NanoClaw Docker environment and resolving common issues.

## 🚀 Quick Health Check
Run this command to see the full state of the system:
```bash
echo "=== Containers ===" && docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}' | grep nanoclaw && \
echo "" && echo "=== System Load ===" && free -h | grep -E "Mem|Swap" && \
echo "" && echo "=== Ghost Check ===" && ps aux | grep "node dist/index.js" | grep -v "docker" | grep -v "grep" || echo "No ghost processes found."
```

---

## 🛠 Diagnostic Toolkit

### View Orchestrator Logs
```bash
# Follow live logs
docker logs nanoclaw-main -f

# Check for delivery errors or duplicates
docker logs nanoclaw-main --tail=50 2>&1 | grep -E "delivered|Failed|Duplicate|already active"
```

### Check Scheduled Tasks
```bash
# See last 10 task runs
sqlite3 store/messages.db "SELECT task_id, run_at, status FROM task_run_logs ORDER BY run_at DESC LIMIT 10;"

# Check next scheduled time for a specific task
sqlite3 store/messages.db "SELECT prompt, next_run FROM scheduled_tasks WHERE status = 'active';"
```

### Container Management
```bash
# Full Rebuild (after code changes)
docker compose down && docker compose build nanoclaw && docker compose up -d nanoclaw

# Restart only (no rebuild)
docker compose restart nanoclaw
```

---

## 👻 The "Ghost Process" Issue
If you see **duplicate messages** or **duplicate cron jobs**, it usually means a NanoClaw process is running on the host machine instead of inside Docker.

**How to fix:**
1. Find the ghost: `ps aux | grep "node dist/index.js" | grep -v "docker"`
2. Kill it: `kill <PID>`
3. Restart Docker: `docker compose restart nanoclaw`

---

## 📖 Knowledge Base (Resolved Issues)

| Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **Duplicate Messages** | Ghost process or race condition | Killed host process; added `state.active` guards in `GroupQueue.ts`. |
| **Wrong Timezone** | Incorrect `TZ` variable | Set `TZ=America/Toronto` in `docker-compose.yml`. |
| **Stuck at "Processing"** | `notifyIdle` bug | Updated `notifyIdle` to close containers if messages are pending. |
| **Container Suicide** | Self-cleanup filter too broad | Updated `cleanupOrphans` to exclude `os.hostname()`. |
| **Missing Source Files** | DinD path translation | Added `NANOCLAW_HOST_PROJECT_ROOT` path translation. |
| **OOM Crashes** | Memory spikes on small VPS | Added 2GB swap and set `--memory=512m` limits on agents. |
| **Silent Bot** | Response buffering bug | Reverted to immediate streaming delivery in `src/index.ts`. |

---

## 📝 Configuration Reference
*   **Timezone:** `America/Toronto` (Confirmed intended)
*   **Project Root:** `/home/maryam/nanoclaw`
*   **Database:** `store/messages.db`
*   **IPC Directory:** `data/ipc/`

---

<details>
<summary><b>📜 Historical Incident Logs (Archived)</b></summary>

### 2026-04-25 — The Ghost Process Incident
Discovered that a detached `node dist/index.js` process was running on the host (PID 718115). This process was competing with the Docker container for the same Telegram messages and database tasks, causing duplicates. Fixed by killing the process and implementing concurrency guards in the code.

### 2026-04-25 — The "Silent Moka" Bug
A fix for duplicate messages introduced a buffering bug where `runAgent` never returned, causing messages to never be sent. Fixed by reverting to immediate delivery with a `text !== lastSentOutput` deduplication guard.

### 2026-04-25 — Timezone Correction
Timezone was accidentally set to Tehran by an assistant. Reverted to Toronto as it is the user's intended timezone.
</details>
