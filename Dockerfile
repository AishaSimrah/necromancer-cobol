FROM ubuntu:24.04

# The COBOL "oracle": one pinned environment used locally and in the cloud.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY cobol-samples/ ./cobol-samples/

RUN cobc -x -free -o /usr/local/bin/interest cobol-samples/interest.cbl

CMD ["sh", "-c", "printf '1000\\n5\\n3\\n' | interest"]
