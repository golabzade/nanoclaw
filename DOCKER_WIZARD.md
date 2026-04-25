# 🧙‍♂️ NanoClaw Docker Wizard (SOP)

**ATTENTION ASSISTANT**: You MUST read and follow these rules before attempting to modify or run this codebase. Failure to do so will result in "Ghost Processes" and duplicate message bugs.

---

## ⛔ Rule 1: No Ghost Processes
NEVER run `npm start` or `node dist/index.js` directly on the host machine while the Docker containers are active. This causes double-execution.
*   **Note**: `RUN npm run build` inside `Dockerfile.main` is safe—it only compiles the code at build-time. The danger is running the compiled code on the host at the same time as the container.
*   **Before starting Docker**: Check for host processes: `ps aux | grep "node dist/index.js" | grep -v "docker"`.
*   **If found**: Kill them before proceeding.

## 🧱 Rule 2: Proper Build Hierarchy
NanoClaw has two distinct layers. Always rebuild the correct one:

1.  **The Orchestrator (`src/` folder)**:
    *   *Symptom*: Change in bot behavior, Telegram logic, or scheduling.
    *   *Action*: `docker compose build nanoclaw && docker compose up -d nanoclaw`
2.  **The Agent Image (`container/` folder)**:
    *   *Symptom*: Change in agent skills, new CLI tools, or Claude Code behavior.
    *   *Action*: `bash container/build.sh && docker compose build nanoclaw && docker compose up -d nanoclaw`

## 🩺 Rule 3: Diagnostic First
Before applying a fix, run the **Quick Health Check** from `DOCKER_ISSUE.md`:
```bash
echo "=== Containers ===" && docker ps -a --format 'table {{.Names}}\t{{.Status}}' | grep nanoclaw && \
echo "=== Ghost Check ===" && ps aux | grep "node dist/index.js" | grep -v "docker" | grep -v "grep" || echo "No ghosts."
```

## 🛠 Rule 4: Volume Mounts & Paths
*   All persistence is in `/app/data`, `/app/store`, and `/app/groups`.
*   **CRITICAL**: `NANOCLAW_HOST_PROJECT_ROOT` in `docker-compose.yml` MUST match the real host path (currently `/home/maryam/nanoclaw`). If you move the project, you MUST update this or agents will fail to mount their source code.

## ⏱ Rule 5: Timezone Integrity
The project is locked to **`America/Toronto`**. Do NOT "fix" this to match the server's physical location unless explicitly asked by the user.

---

## 🔄 Development Workflow
When the user asks for a new feature:
1.  **Dev Phase**: Modify files in `src/`.
2.  **Validate Phase**: Run `npm run build` (tsc) locally just to check for syntax errors.
3.  **Build Phase**: Run the Docker rebuild command (Rule 2).
4.  **Verify Phase**: Check `docker logs nanoclaw-main -f` to ensure the bot connects.

---

## 🧠 Advanced Debugging Protocol (Follow when stuck)
If you encounter a Docker error, follow this "Falsification" workflow:

1.  **Raw Evidence**: Do NOT rely on summaries like "it's a permission error." You MUST capture:
    *   `docker logs <container>`
    *   `docker inspect <container>`
    *   `ls -la` of the mounted host directories.
2.  **Critique Diagnosis**: After forming a hypothesis, ask yourself: *"Tear this diagnosis apart. What did I miss? What if the problem is actually the host GID or the volume path translation?"*
3.  **Hostile SRE Review**: Before applying a fix, simulate a "Hostile SRE" review. Ask: *"What could go wrong in production? Will this fix survive a server reboot? Is it idempotent?"*
4.  **Confirm Success**: A fix is only confirmed once the **Raw Evidence** shows the error message is gone and the service is `Up`.

