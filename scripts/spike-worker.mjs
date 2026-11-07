// THROWAWAY spike (task 1.2). Not part of the final image.
// Modes: no args = driver (spawns itself as the Worker); --worker = framed-stdio Worker.
// Frame = 4-byte big-endian length + JSON payload.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROGRAM = process.env.SPIKE_PROGRAM ?? '/opt/interest';
const RUNS = Number(process.env.SPIKE_RUNS ?? 500);
const WARMUP = 20;
const LIMIT_MS = 10;
const UID = 20000;
const GID = 20000;
const STDIN = '1000\n5\n3\n';
const ENV = { PATH: '/usr/bin:/bin', LC_ALL: 'C.UTF-8', HOME: '/nonexistent' };

function encodeFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function makeDecoder(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) return;
      const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
      buf = buf.subarray(4 + len);
      onMessage(msg);
    }
  };
}

function runChild(withPrlimit) {
  return new Promise((resolve, reject) => {
    const cmd = withPrlimit ? 'prlimit' : PROGRAM;
    const args = withPrlimit
      ? ['--as=1073741824', '--cpu=5', '--nproc=64', '--fsize=1048576', '--core=0', '--', PROGRAM]
      : [];
    const t0 = process.hrtime.bigint();
    const child = spawn(cmd, args, {
      uid: UID,
      gid: GID,
      detached: true,
      env: ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      resolve({ ms, code, out });
    });
    child.stdin.end(STDIN);
  });
}

function workerMain() {
  const send = (m) => process.stdout.write(encodeFrame(m));
  const decode = makeDecoder(async (msg) => {
    if (msg.type === 'echo') {
      send({ id: msg.id, type: 'echo', payload: msg.payload });
    } else if (msg.type === 'run') {
      try {
        const r = await runChild(msg.prlimit);
        send({ id: msg.id, type: 'ran', ms: r.ms, code: r.code, out: r.out });
      } catch (e) {
        send({ id: msg.id, type: 'error', message: String(e) });
      }
    }
  });
  process.stdin.on('data', decode);
  process.stdin.on('end', () => process.exit(0));
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};
const fmt = (n) => n.toFixed(3).padStart(9);

async function driverMain() {
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map();
  let nextId = 1;
  worker.stdout.on(
    'data',
    makeDecoder((m) => {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) p(m);
    }),
  );
  const call = (req) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      worker.stdin.write(encodeFrame({ ...req, id }));
    });

  const timed = async (fn) => {
    const t0 = process.hrtime.bigint();
    const r = await fn();
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, r };
  };

  // Sanity: the program works under the full Phase B setup.
  const check = await call({ type: 'run', prlimit: true });
  if (check.type !== 'ran' || check.code !== 0 || !check.out.includes('BALANCE:')) {
    console.error('Sanity run failed:', JSON.stringify(check));
    process.exit(2);
  }
  console.log(`sanity output: ${check.out.trim()}`);

  const a = [];
  const bWorker = [];
  const bClient = [];
  const cWorker = [];
  const payload = 'x'.repeat(64);
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const ra = await timed(() => call({ type: 'echo', payload }));
    const rb = await timed(() => call({ type: 'run', prlimit: true }));
    const rc = await call({ type: 'run', prlimit: false });
    if (rb.r.code !== 0 || rc.code !== 0) {
      console.error('Child failed', JSON.stringify(rb.r), JSON.stringify(rc));
      process.exit(2);
    }
    if (i >= WARMUP) {
      a.push(ra.ms);
      bWorker.push(rb.r.ms);
      bClient.push(rb.ms);
      cWorker.push(rc.ms);
    }
  }
  worker.stdin.end();

  // Overhead = (spawn prlimit + program) - (program alone) + frame round trip.
  const overhead = mean(bWorker) - mean(cWorker) + mean(a);
  console.log(`runs: ${RUNS} sequential (after ${WARMUP} warmup), uid=${UID} gid=${GID} detached fixed-env`);
  console.log(`                                              mean(ms)   p95(ms)`);
  console.log(`(a) frame round trip only                   ${fmt(mean(a))} ${fmt(p95(a))}`);
  console.log(`(b) prlimit + program (worker-side)         ${fmt(mean(bWorker))} ${fmt(p95(bWorker))}`);
  console.log(`(b') same, incl. frame round trip (client)  ${fmt(mean(bClient))} ${fmt(p95(bClient))}`);
  console.log(`(c) program without prlimit (worker-side)   ${fmt(mean(cWorker))} ${fmt(p95(cWorker))}`);
  console.log(`prlimit-only cost  (b - c): ${(mean(bWorker) - mean(cWorker)).toFixed(3)} ms`);
  console.log(`Worker overhead = (b - c) + a = ${overhead.toFixed(3)} ms (limit < ${LIMIT_MS} ms)`);
  if (overhead >= LIMIT_MS) {
    console.log('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

if (process.argv.includes('--worker')) workerMain();
else await driverMain();
