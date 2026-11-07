# Oracle image: multi-stage build. One pinned environment used locally and in the cloud.
#
# Stage 1 base is pinned by tag AND digest:
#   node:22.11.0-bookworm-slim
#   sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da
# (Same digest is recorded in docs/kiro-log.md.)
FROM node:22.11.0-bookworm-slim@sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da AS build

WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Worker modules plus the shared modules the Worker imports.
COPY src/oracle/worker/ ./src/oracle/worker/
COPY src/oracle/protocol.ts src/oracle/framing.ts src/oracle/capture.ts src/oracle/types.ts src/oracle/config.ts ./src/oracle/
RUN npm run build:worker

FROM ubuntu:24.04

# The COBOL "oracle": GnuCOBOL 3.1.2 from the Ubuntu 24.04 archive.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# Node binary (same approach as scripts/Dockerfile.spike) and the bundled Worker.
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chmod=0555 /build/dist/worker.js /opt/oracle/worker.js

# Unprivileged identities used for per-program sandboxing (slot uids start at 20000).
RUN groupadd --gid 20000 oracle-run \
 && useradd --uid 20000 --gid 20000 --no-create-home --shell /usr/sbin/nologin oracle

ENV NECROMANCER_IN_ORACLE_IMAGE=1

WORKDIR /app
COPY cobol-samples/ ./cobol-samples/

RUN cobc -x -free -o /usr/local/bin/interest cobol-samples/interest.cbl

# Runs as root on purpose: the Worker drops to a per-program uid/gid for each child.
USER root

CMD ["sh", "-c", "printf '1000\\n5\\n3\\n' | interest"]
