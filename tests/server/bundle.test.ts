import { exec, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Bundle test: builds the single-file server bundle, relocates it into a temp tree with the
 * runtime data, starts it as a child process, and checks the catalog is read from the
 * data directories (not from next to the bundle). Nothing is skipped.
 */

const REPO = path.resolve(import.meta.dirname, "../..");
const HOOK_TIMEOUT = 180_000;
const TEST_TIMEOUT = 30_000;
const READY_DEADLINE_MS = 30_000;
const VARIANTS = ["correct", "subtle", "naive"] as const;

let tmp = "";
let port = 0;
let child: ChildProcess | undefined;
let childOutput = "";

function build(): Promise<void> {
  return new Promise((resolve, reject) => {
    exec("npm run build:server", { cwd: REPO, timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) resolve();
      else reject(new Error(`npm run build:server failed: ${error.message}\n${stdout}\n${stderr}`));
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const p = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => {
        resolve(p);
      });
    });
  });
}

interface Reply {
  readonly status: number;
  readonly body: string;
}

function get(requestPath: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: "GET", path: requestPath, headers: { Connection: "close" }, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + READY_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`bundle exited early with code ${String(child.exitCode)}:\n${childOutput}`);
    }
    try {
      const r = await get("/api/health");
      if (r.status === 200) return;
    } catch {
      // not listening yet
    }
    await delay(200);
  }
  throw new Error(`bundle did not become ready:\n${childOutput}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("expected a JSON object");
  return parsed;
}

beforeAll(async () => {
  await build();
  tmp = await mkdtemp(path.join(os.tmpdir(), "necromancer-bundle-"));
  await mkdir(path.join(tmp, "dist", "server"), { recursive: true });
  await cp(path.join(REPO, "dist", "server", "server.js"), path.join(tmp, "dist", "server", "server.js"));
  await cp(path.join(REPO, "cobol-samples"), path.join(tmp, "cobol-samples"), {
    recursive: true,
    filter: (src) => path.basename(src) !== "bin",
  });
  await cp(
    path.join(REPO, "src", "translator", "translations"),
    path.join(tmp, "src", "translator", "translations"),
    { recursive: true },
  );
  await cp(path.join(REPO, "public"), path.join(tmp, "public"), { recursive: true });
  port = await freePort();
  child = spawn(process.execPath, [path.join(tmp, "dist", "server", "server.js")], {
    cwd: tmp,
    env: {
      ...process.env,
      PORT: String(port),
      NECROMANCER_WORK_ROOT: path.join(tmp, "work"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (d: Buffer) => {
    childOutput += d.toString("utf8");
  });
  child.stderr?.on("data", (d: Buffer) => {
    childOutput += d.toString("utf8");
  });
  await waitReady();
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (child !== undefined && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => {
      child?.once("exit", () => {
        resolve();
      });
    });
    child.kill("SIGKILL");
    await exited;
  }
  if (tmp !== "") await rm(tmp, { recursive: true, force: true });
}, HOOK_TIMEOUT);

describe("server bundle relocated to a temp tree", () => {
  it(
    "serves the interest sample read from the copied data directories",
    async () => {
      const r = await get("/api/samples/interest");
      expect(r.status).toBe(200);
      const body = parseObject(r.body);
      const onDisk = await readFile(path.join(REPO, "cobol-samples", "interest.cbl"), "utf8");
      expect(typeof body["cobolSource"]).toBe("string");
      expect(body["cobolSource"]).not.toBe("");
      expect(body["cobolSource"]).toBe(onDisk);

      const translations = body["translations"];
      expect(Array.isArray(translations)).toBe(true);
      const list = translations as unknown[];
      expect(list).toHaveLength(3);
      const seen: string[] = [];
      for (const t of list) {
        if (!isRecord(t)) throw new Error("translation is not an object");
        const variant = t["variant"];
        expect(VARIANTS).toContain(variant);
        const variantName = String(variant);
        seen.push(variantName);
        const expected = await readFile(
          path.join(REPO, "src", "translator", "translations", `interest.${variantName}.ts`),
          "utf8",
        );
        expect(typeof t["source"]).toBe("string");
        expect(t["source"]).not.toBe("");
        expect(t["source"]).toBe(expected);
      }
      expect([...seen].sort()).toEqual([...VARIANTS].sort());
    },
    TEST_TIMEOUT,
  );

  it(
    "reports health with the documented shape",
    async () => {
      const r = await get("/api/health");
      expect(r.status).toBe(200);
      const body = parseObject(r.body);
      expect(["ok", "degraded"]).toContain(body["status"]);
      expect(["ready", "unavailable"]).toContain(body["oracle"]);
      const cobc = body["cobcVersion"];
      expect(cobc === null || typeof cobc === "string").toBe(true);
      expect(typeof body["uptimeMs"]).toBe("number");
    },
    TEST_TIMEOUT,
  );

  it("has no copy of the data directories next to the bundle", () => {
    const bundleDir = path.join(tmp, "dist", "server");
    for (const name of ["cobol-samples", "translations", "public", "src"]) {
      expect(existsSync(path.join(bundleDir, name))).toBe(false);
    }
    expect(existsSync(path.join(tmp, "dist", "cobol-samples"))).toBe(false);
    expect(existsSync(path.join(tmp, "dist", "public"))).toBe(false);
  });
});
