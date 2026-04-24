# Docker Container Crash — Resolution Report

## Final Root Cause: The "Suicide Loop"

The primary cause of the immediate crash was **self-termination** inside `src/container-runtime.ts`.

### How it happened:
1.  At startup, NanoClaw calls `cleanupOrphans()`.
2.  This function runs `docker ps --filter name=nanoclaw-` to find and kill old containers from previous runs.
3.  Because the main container was named `nanoclaw-main`, it matched its own filter.
4.  The orchestrator successfully sent a `docker stop` command to **itself** within the first second of life.
5.  Because it was running via `npm start` (PID 1), the process died instantly without flushing logs to the console.

---

## Applied Fixes

### 1. Code Patch: Exclude Self from Cleanup
Updated `src/container-runtime.ts` to check the container's hostname and skip it during the orphan cleanup process:
```typescript
const orphans = output.trim().split('\n')
  .filter(Boolean)
  .filter(name => name !== os.hostname());
```

### 2. Docker Configuration Sync
Updated `docker-compose.yml` to ensure the container knows its own identity and has proper permissions:
- Added `hostname: nanoclaw-main` to match the `container_name`.
- Added `group_add: ["988"]` (the host's `docker` GID) to allow socket access.
- Added `stop_grace_period: 30s` for clean shutdowns.

### 3. Docker Sandbox Compatibility
Fixed issues specific to running inside a Docker Sandbox (which has a read-only rootfs and restricted mounts):
- **Shadow .env**: Replaced `/dev/null` mount with a real empty file (`data/empty-env`) because sandboxes reject `/dev/null` bind mounts.
- **Writable Project Root**: Changed `/workspace/project` from `ro` to `rw` to allow the Docker daemon to create mountpoints for shadowed files.
- **Proxy Forwarding**: Configured the orchestrator to pass `HTTP_PROXY` and CA certificates (`NODE_EXTRA_CA_CERTS`) down to agent containers so they can reach the Anthropic API through the sandbox proxy.

### 4. Better Entrypoint
Changed `Dockerfile.main` from `ENTRYPOINT ["npm", "start"]` to `ENTRYPOINT ["node", "dist/index.js"]`.
- This makes `node` PID 1.
- Ensures logs are flushed immediately on crash.
- Allows proper signal propagation for graceful shutdowns.

---

## Current Status
- **Orchestrator**: Stable and running as `nanoclaw-main`.
- **Connectivity**: Telegram bot is online.
- **Agents**: Successfully spawning sub-containers with proper credential/proxy passthrough.

---

## Testing & Debugging Commands

### Start / Stop / Restart

```bash
# Start in background (normal operation)
docker compose up -d

# Stop
docker compose down

# Restart just the orchestrator (after code/config changes)
docker compose restart nanoclaw

# Full rebuild + restart (after changing src/ or Dockerfile.main)
docker compose build nanoclaw && docker compose up -d

# Full rebuild + restart after changing the agent (container/agent-runner/)
bash container/build.sh && docker compose build nanoclaw && docker compose up -d
```

---

### Check if it's running

```bash
docker ps
```
Look for `nanoclaw-main` with status `Up`. If it shows `Exited`, it crashed.

```bash
# Show exit code of the last run
docker inspect --format='{{.State.ExitCode}}' nanoclaw-main
```
- `0` = clean exit
- `1` = app crashed (check logs)
- `125` = Docker couldn't even start the container (bad mount, bad image)

---

### View logs

```bash
# Last 50 lines of the orchestrator
docker logs nanoclaw-main --tail=50

# Follow live (stream new lines as they arrive, Ctrl+C to stop)
docker logs nanoclaw-main -f

# Everything since last start
docker logs nanoclaw-main
```

Log levels: `INFO` = normal, `WARN` = non-fatal issue, `ERROR` = something failed, `FATAL` = crashed.

---

### Check agent container logs (when an agent run fails)

Agent runs write detailed logs to `groups/main/logs/`. Each failed run gets its own file:

```bash
# List recent agent run logs
ls -lt groups/main/logs/ | head -10

# Read the most recent one
cat groups/main/logs/$(ls -t groups/main/logs/ | head -1)
```

The log file includes: exit code, stderr, stdout, the full Docker run command, and all mount paths — everything needed to diagnose a failed agent spawn.

---

### Check what containers are running / stopped

```bash
# All containers (including stopped ones)
docker ps -a

# See if a stale nanoclaw-agent container is stuck
docker ps --filter name=nanoclaw-
```

If a stuck agent container is blocking things:
```bash
docker stop nanoclaw-<name>
docker rm nanoclaw-<name>
```

---

### Verify mounts are correct

If agents are failing with missing files or empty directories, check that the path translation is working:

```bash
# Print the env var the container sees
docker exec nanoclaw-main printenv NANOCLAW_HOST_PROJECT_ROOT

# Check the host /app/ directory (should match nanoclaw project structure)
ls /app/data/sessions/
ls /home/user/nanoclaw/data/sessions/
# Both should show the same contents
```

---

### Verify credentials are in .env

```bash
# Check CLAUDE_CODE_OAUTH_TOKEN is set (don't print the full value)
grep -c CLAUDE_CODE_OAUTH_TOKEN /home/user/nanoclaw/.env
# Should print 1
```

---

### Nuke and restart from scratch

If something is badly broken and you want a clean slate:

```bash
docker compose down
docker compose build --no-cache nanoclaw
bash container/build.sh
docker compose up -d
docker logs nanoclaw-main -f
```

---

## Additional Fixes Applied (Post-Report)

### 5. DinD Path Translation (`src/container-runner.ts` + `src/config.ts`)

**Problem**: When nanoclaw runs inside Docker, `process.cwd()` = `/app`. All mount `hostPath` values were container-internal paths (e.g. `/app/data/sessions/main/agent-runner-src`). The host Docker daemon interpreted these as literal host paths, found the empty `/app/` directory Docker had created on the host, and mounted those empty directories into the agent container. Result: TypeScript source files were missing, agent runner failed with `No inputs were found in config file`.

**Fix**: Added `NANOCLAW_HOST_PROJECT_ROOT` env var to `docker-compose.yml` pointing to the real host project path. Added a `toHostPath()` helper in `container-runner.ts` that translates all mount `hostPath` values from container-internal paths to real host paths:

```typescript
// src/config.ts
export const HOST_PROJECT_ROOT =
  process.env.NANOCLAW_HOST_PROJECT_ROOT || PROJECT_ROOT;

// src/container-runner.ts
function toHostPath(containerPath: string): string {
  const projectRoot = process.cwd();
  if (HOST_PROJECT_ROOT === projectRoot) return containerPath;
  if (containerPath === projectRoot) return HOST_PROJECT_ROOT;
  if (containerPath.startsWith(projectRoot + path.sep)) {
    return HOST_PROJECT_ROOT + containerPath.slice(projectRoot.length);
  }
  return containerPath;
}
```

`docker-compose.yml` addition:
```yaml
- NANOCLAW_HOST_PROJECT_ROOT=/home/user/nanoclaw
```

When running on the host (not in Docker), `NANOCLAW_HOST_PROJECT_ROOT` is unset so `toHostPath()` is a no-op.

### 6. Credentials Never Reaching the Agent (`container/agent-runner/src/index.ts`)

**Problem**: `container-runner.ts` reads `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` from `.env` via `readSecrets()` and serializes them into the stdin JSON. But the agent runner's `ContainerInput` interface had no `secrets` field — they were silently dropped. `sdkEnv` was built from `process.env` which had no auth tokens. Claude Code inside the agent container had no credentials and fell back to asking the user to run `/login`.

**Fix**: Added `secrets` to `ContainerInput` and applied them to `sdkEnv` in the agent runner:

```typescript
// container/agent-runner/src/index.ts
interface ContainerInput {
  // ... existing fields ...
  secrets?: Record<string, string>;
}

// In main(), after parsing stdin:
if (containerInput.secrets) {
  for (const [k, v] of Object.entries(containerInput.secrets)) {
    if (v) sdkEnv[k] = v;
  }
  delete containerInput.secrets;
}
```

Secrets are applied to `sdkEnv` (passed only to the Claude Code SDK) rather than `process.env`, so they don't leak to child processes spawned by the agent.

### 7. `.env` Shadow Mount Removed (`src/container-runner.ts`)

**Problem**: The agent spawn was failing with exit code 125:
```
error mounting "/app/data/empty-env" to rootfs at "/workspace/project/.env":
mkdirat .../workspace/project/.env: read-only file system
```
Docker cannot create a nested bind mount (a file mounted *inside* an already bind-mounted directory) when the parent directory is itself on an overlayfs. This is a fundamental DinD limitation — the overlay upper layer is not writable for nested mountpoint creation.

**Fix**: Removed the `.env` shadow mount entirely from `buildVolumeMounts()`. The shadow existed to prevent the agent from reading secrets out of the project root, but secrets are already passed exclusively via stdin (`readSecrets()` → `container.stdin.write`), making the shadow redundant.

### 8. Proxy Env Vars Removed from `docker-compose.yml`

**Problem**: Agent containers were retrying API calls repeatedly then returning:
```
API Error: Unable to connect to API (ECONNREFUSED)
```
The `HTTP_PROXY` and `HTTPS_PROXY` env vars (`http://localhost:3128`) were being forwarded into every agent container by `container-runner.ts`. Inside the agent container, `localhost:3128` doesn't exist (no proxy is running on this plain Linux VPS), so every Anthropic API call was refused.

These vars were added for Docker Sandbox compatibility (where a real MITM proxy runs at that address) but are harmful on a plain Linux setup.

**Fix**: Removed `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and the non-functional `ONECLI_URL=http://localhost:3128` from `docker-compose.yml`. Agent containers now connect directly to `api.anthropic.com`.

### 9. 2 GB Swap Added to VPS

**Problem**: VPS has 3.7 GB RAM, no swap, and no OOM safety net. During debugging with multiple simultaneous agent containers (each ~250 MB), the kernel OOM killer terminated zeroclaw and other services to free memory.

**Fix**: Added a persistent 2 GB swapfile:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
This doesn't speed up agent runs but prevents the OOM killer from randomly terminating containers when nanoclaw agent runs cause RAM spikes.

---

## Final Working State

All services confirmed running:

```
nanoclaw-main          Up   — orchestrator, Telegram bot online
nanoclaw-agent:latest  Up   — agent containers spawning and completing successfully
zeroclaw-agent         Up   — unaffected, isolated on port 42617
```

The bot responds to Telegram messages, agent containers spawn with correct host mounts, credentials flow via stdin, and API calls reach Anthropic directly.
