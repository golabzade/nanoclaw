# NanoClaw Server Guide

## Server Specs
- **RAM:** 3.73 GiB total (~840 MiB available)
- **Swap:** 2.0 GiB (95% full - danger zone)
- **Running agents:** NanoClaw, Zeroclaw (test)

## Architecture: Docker-out-of-Docker (DooD)

NanoClaw uses Docker-out-of-Docker:

- Container mounts the Docker socket from host
- Container acts as a **client** to host's Docker daemon
- The actual Docker daemon runs on your host

## Memory Issues

### Exit Code 137 = OOM Kill

When a container exits with code 137, the Linux OOM killer terminated it due to memory exhaustion.

### Your System State
- RAM: 77% used, ~840 MiB available
- Swap: 95% used (nearly full)
- When RAM runs out, system uses swap heavily → becomes slow → crash risk

## Checking System Status (Safe Commands)

```bash
# Check Docker memory usage
docker info | grep -i memory

# Check system memory
free -h

# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# Check container status
docker ps -a --format "{{.Names}}\t{{.Status}}"

# View logs
cat logs/nanoclaw.log
```

## Safe Cleanup Commands

```bash
# Clean IPC temp files (recreates automatically)
rm -rf data/ipc/*/messages/*.json

# Clean old container logs (safe - just .log files)
rm -rf groups/*/logs/*.log

# Clean npm cache
npm cache clean --force
```

## Memory Limits

### Recommended Settings for NanoClaw

Add to `src/container-runner.ts` in `buildContainerArgs()`:

```typescript
const args: string[] = [
  'run', '-i', '--rm',
  '--memory=512m',        // Max 512 MB RAM
  '--memory-swap=1g',     // Max 512 MB + 512 MB swap
  '--name', containerName
];
```

## Quick Reference

```bash
# Restart nanoclaw (if running via docker-compose)
cd /home/maryam/nanoclaw
docker-compose down
docker-compose up -d

# Restart nanoclaw (if running via node directly)
sudo kill <pid>
nohup node dist/index.js >> logs/nanoclaw.log 2>&1 &
```

## Troubleshooting

### Container Keeps Getting OOM Killed
1. Check available memory: `free -h`
2. Consider adding memory limits to container-runner.ts
3. Restart services to free RAM

### Image Missing
1. Rebuild agent image: `./container/build.sh`
