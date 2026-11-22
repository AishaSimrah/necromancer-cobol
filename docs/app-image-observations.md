# App image observations (task 6.4)

Image: `necromancer-app`, built with `docker build -f Dockerfile.app -t necromancer-app .`
Host: Windows, Docker Engine 29.9.2 (Docker Desktop, 3.718 GiB visible to containers).
Checks were run by hand in PowerShell, not with `scripts/check-app-image.sh` (bash on this host is the WSL stub).

## Build

| Figure | Value |
| --- | --- |
| Build time | about 85 s wall clock (BuildKit layer cache may have been warm for the apt and `npm ci` layers) |
| Image size | 630,750,630 bytes (about 631 MB) |
| GnuCOBOL | `cobc` 3.1.2.0, reported in `/api/health` |

## Per configuration

Startup time is measured from the start of `docker run -d` to the first successful `GET /api/health`, so it includes container creation. `uptimeMs` is the server's own figure for that first response.

| Configuration | First health (incl. docker run) | Server uptimeMs at first health | First health body | oracle after `?probe=1` | `id -u` | Idle memory | Docker health |
| --- | --- | --- | --- | --- | --- | --- | --- |
| default Work_Root | 3.68 s (1.4 s on an earlier run) | 694 ms | degraded / unavailable | ready (about 0.6 s later) | 10001 | 40.0 MiB | healthy |
| `--tmpfs /tmp` | 0.85 s | 266 ms | degraded / unavailable | ready | 10001 | 34.9 MiB | healthy |
| `--read-only --tmpfs /tmp --tmpfs /home/necro/work:rw,exec,nosuid,uid=10001,gid=10001,mode=0700,size=128m` | 1.03 s | 363 ms | degraded / unavailable | ready | 10001 | 27.8 MiB | healthy |

Notes:
- The first `/api/health` is `degraded` because the initial probe has not finished. This is the designed initial state (`unavailable` until a real probe matches).
- The 3.68 s on the default run is the Docker Desktop container start on a cold run, not the server (uptime was 694 ms). The server itself answered well under 3 s in every run.
- Idle memory was read with `docker stats --no-stream` about 3 s after the probe. Memory during a 2000-case run is not measured yet (needs task 11; revisit in 13.3).

## Other checks

- `GET /api/samples/interest` in all three configurations: `cobolSource` length 1201, translations `correct` 1016, `subtle` 1153, `naive` 844 characters, all non-empty. The catalog paths resolve from `/app/dist/server/server.js`.
- Process list (`docker top`) after a probe: `node dist/server/server.js` (uid 10001) and its child `node /opt/oracle/worker.js --work-root /home/necro/work ...` (uid 10001). The Worker runs as the same uid as the server.
- `noexec`: `--tmpfs /tmp:rw,noexec -e NECROMANCER_WORK_ROOT=/tmp/work` gives `{"status":"degraded","oracle":"unavailable",...}` even after `?probe=1`, and the log contains `work root /tmp/work does not allow executing files (noexec mount?)`. The server keeps listening.

## Cleanup

All test containers were removed with `docker rm -f`.
