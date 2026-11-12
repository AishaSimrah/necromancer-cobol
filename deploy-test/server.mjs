import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 10000;
const TIMEOUT_MS = 5000;

const baseDir = process.env.TMPDIR || tmpdir();
mkdirSync(baseDir, { recursive: true });
const workDir = mkdtempSync(join(baseDir, 'cobol-'));
const binary = join(workDir, 'interest');

// Compile once at startup.
const cobcVersion = execFileSync('cobc', ['--version'], { encoding: 'utf8' }).split('\n')[0];
execFileSync('cobc', ['-x', '-free', '-o', binary, 'interest.cbl'], { stdio: 'inherit' });
console.log(`compiled with ${cobcVersion}`);

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>COBOL spike</title></head>
<body>
<h1>COBOL on Render spike</h1>
<button id="run">Run (1000, 5, 3)</button>
<pre id="out"></pre>
<script>
document.getElementById('run').addEventListener('click', async () => {
  const r = await fetch('/run?principal=1000&rate=5&years=3');
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
});
</script>
</body></html>`;

function runCobol(stdin) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, exitCode: timedOut ? -1 : code, ms: Date.now() - start, cobcVersion });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: String(err), exitCode: -1, ms: Date.now() - start, cobcVersion });
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/run') {
    const num = /^-?\d+(\.\d+)?$/;
    const values = ['principal', 'rate', 'years'].map((k) => url.searchParams.get(k) ?? '');
    if (!values.every((v) => num.test(v))) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'principal, rate, years must be numeric' }));
      return;
    }
    const result = await runCobol(values.join('\n') + '\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`listening on 0.0.0.0:${PORT}`));
