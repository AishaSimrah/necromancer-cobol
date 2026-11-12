FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol nodejs ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root user and a writable temp/work dir
RUN useradd --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /app /tmp/necro \
 && chown -R app:app /app /tmp/necro

WORKDIR /app
COPY --chown=app:app interest.cbl server.mjs ./

ENV TMPDIR=/tmp/necro
ENV PORT=10000
EXPOSE 10000

USER app
CMD ["node", "server.mjs"]
