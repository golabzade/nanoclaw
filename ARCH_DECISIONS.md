# NanoClaw Architecture & Decision Logs

This document tracks major architectural decisions, technical lessons learned, and significant update logs for the NanoClaw project.

---

## 🏗 Decision Log: 2026-04-25 — Concurrency Guards & Ghost Detection
**Context**: Multiple instances of the bot were running simultaneously, leading to duplicate Telegram replies and double-triggering of cron jobs.

**Resolution**:
- **Discovery**: Found a "ghost" process running on the host machine (`node dist/index.js`) while a separate instance was running in Docker.
- **Architectural Change**: Implemented a state-based guard in `GroupQueue.ts`. The orchestrator now definitively blocks any attempt to spawn a second agent container for a group that is already marked as `active`.
- **Infrastructure**: Added 2GB of swap and memory limits (`512MB`) to prevent OOM spikes on low-RAM VPS environments.

---

## 🧪 Technical Insight: Agent Comparison (The Nine-Bug Chain)
**Context**: An investigation into why some agents (like Gemini CLI) fail on complex multi-step bugs while Nanoclaw's custom runner succeeds.

**Key Lessons**:
1. **Falsification vs. Confirmation**: Good debugging requires attempting to prove a hypothesis wrong rather than looking for logs that prove it right.
2. **Ground Truth**: Returning to the source code (`container-runner.ts`, etc.) is faster than chasing logs in a crashing environment.
3. **Action Budgets**: Models perform better when they don't know they have a "turn limit," as they don't rush to the first plausible (but wrong) conclusion.

---

## 🔄 Update Log: 2026-04-20 — The "Lite Update" Strategy
**Context**: Upstream repository moved toward a major V2 refactor that removed Telegram support.

**Decision**:
- Performed a **"Lite Update"** by cherry-picking only critical bug fixes (Commit `047a422` for OneCLI auth) while rejecting the removal of `src/channels/telegram.ts`.
- **Reasoning**: Stability and feature preservation were prioritized over staying on the latest upstream version.
- **Branching**: Created `save-point-20260420` as a recovery branch.

---

## 🌍 Decision: Standardized Timezone (Toronto)
**Context**: Conflicting assistant sessions tried to "sync" the bot to server-local time (Tehran) versus user-local time (Toronto).

**Decision**: Timezone is hardcoded to `America/Toronto` in `docker-compose.yml`. Even if the server is moved to a different physical region, the bot maintains the user's local schedule.
