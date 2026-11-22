# App image: the Necromancer server, the Oracle Worker and GnuCOBOL in one container.
# The existing Dockerfile (Oracle image) is separate and unchanged.
#
# Stage 1 base is pinned by tag AND digest, same as the Oracle image:
#   node:22.11.0-bookworm-slim
#   sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da
FROM node:22.11.0-bookworm-slim@sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da AS build

WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build:worker && npm run build:server

# Stage 2: runtime. GnuCOBOL 3.1.2 from the Ubuntu 24.04 archive, Node copied from stage 1.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chmod=0555 /build/dist/worker.js /opt/oracle/worker.js

# Fixed non-root identity. ubuntu:24.04 already has user "ubuntu" at uid/gid 1000,
# so 10001 is free. HOME and the default work root exist at build time.
RUN groupadd --gid 10001 necro \
 && useradd --uid 10001 --gid 10001 --home-dir /home/necro --create-home \
            --shell /usr/sbin/nologin necro \
 && mkdir -p /home/necro/work \
 && chown -R 10001:10001 /home/necro \
 && chmod 0700 /home/necro/work

WORKDIR /app
COPY --from=build --chmod=a+rX /build/dist/server/server.js ./dist/server/server.js
COPY --chmod=a+rX public/ ./public/
# Only the .cbl sources are needed at runtime (not cobol-samples/bin).
COPY --chmod=a+rX cobol-samples/*.cbl ./cobol-samples/
COPY --chmod=a+rX src/translator/translations/ ./src/translator/translations/

ENV NODE_ENV=production \
    PORT=10000 \
    HOME=/home/necro \
    NECROMANCER_IN_ORACLE_IMAGE=1
EXPOSE 10000

# No curl in the image; Node 22 has global fetch. Healthy on HTTP 200 only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'10000')+'/api/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"]

USER 10001:10001
CMD ["node", "dist/server/server.js"]
