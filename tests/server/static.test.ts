import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentTypeFor, resolveStaticPath, serveStatic } from "../../src/server/static-files.js";

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let base: string;
let root: string;
let outside: string;
let server: Server;
let port: number;
let fileSymlinkWorks = false;
let dirLinkWorks = false;

function send(method: string, rawPath: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function tryLink(target: string, link: string, type: "file" | "dir" | "junction"): Promise<boolean> {
  try {
    await symlink(target, link, type);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return false;
    throw err;
  }
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "necro-static-"));
  const rawRoot = path.join(base, "public");
  outside = path.join(base, "outside");
  await mkdir(path.join(rawRoot, "sub"), { recursive: true });
  await mkdir(path.join(rawRoot, ".hidden"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(rawRoot, "index.html"), "<!doctype html><title>x</title>");
  await writeFile(path.join(rawRoot, "app.js"), "export {};");
  await writeFile(path.join(rawRoot, "style.css"), "a{}");
  await writeFile(path.join(rawRoot, "data.json"), "{}");
  await writeFile(path.join(rawRoot, "logo.svg"), "<svg/>");
  await writeFile(path.join(rawRoot, "notes.txt"), "hello");
  await writeFile(path.join(rawRoot, "blob.bin"), "bin");
  await writeFile(path.join(rawRoot, "sub", "index.html"), "<p>sub</p>");
  await writeFile(path.join(rawRoot, ".secret"), "dotfile");
  await writeFile(path.join(rawRoot, ".hidden", "a.txt"), "hidden");
  await writeFile(path.join(outside, "secret.txt"), "outside secret");
  fileSymlinkWorks = await tryLink(path.join(outside, "secret.txt"), path.join(rawRoot, "evil.txt"), "file");
  // A junction needs no privilege on Windows; on POSIX "junction" is ignored and a normal dir symlink is made.
  dirLinkWorks = await tryLink(outside, path.join(rawRoot, "outdir"), process.platform === "win32" ? "junction" : "dir");
  root = await realpath(rawRoot);
  server = createServer((req, res) => {
    void serveStatic(req, res, root);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(base, { recursive: true, force: true });
});

const FRAGMENTS: readonly string[] = [
  "..", ".", "%2e%2e", "%2E%2E", "%2e", "%00", "\0", "\\", "%5c", "%2f", "/", "//",
  ".secret", ".hidden", "sub", "outdir", "evil.txt", "secret.txt", "index.html", "app.js",
  "style.css", "a.txt", "..%2f", "%252e%252e", "%", "%zz", "C:", "C:\\", "~", " ", "\u00e9",
];

const pathArb: fc.Arbitrary<string> = fc.oneof(
  fc.array(fc.constantFrom(...FRAGMENTS), { minLength: 0, maxLength: 8 }).map((a) => a.join("")),
  fc.array(fc.constantFrom(...FRAGMENTS), { minLength: 0, maxLength: 6 }).map((a) => "/" + a.join("/")),
  fc.string({ maxLength: 40 }).map((s) => "/" + s),
  fc.string({ maxLength: 40 }),
  fc.constantFrom("/etc/passwd", "C:/Windows/win.ini", "/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"),
);

function hasDotSegment(rel: string): boolean {
  return rel.split(path.sep).some((s) => s.startsWith("."));
}

describe("static path resolution", () => {
  // Feature: necromancer-server, Property 3: Static path resolution never leaves the Static_Root
  it("Property 3: result is null or a regular file inside the root with no dot segment", async () => {
    // **Validates: Requirements 2.3, 2.4**
    await fc.assert(
      fc.asyncProperty(pathArb, async (raw) => {
        const target = await resolveStaticPath(raw, root);
        if (target === null) return;
        const rel = path.relative(root, target.filePath);
        expect(rel.startsWith("..")).toBe(false);
        expect(path.isAbsolute(rel)).toBe(false);
        expect(hasDotSegment(rel)).toBe(false);
        expect(await realpath(target.filePath)).toBe(target.filePath);
        expect(target.filePath.startsWith(root + path.sep)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("Property 3 over HTTP: any raw path answers 404 or a file body, never a directory listing", async () => {
    // **Validates: Requirements 2.3, 2.4**
    const rawArb = fc
      .array(fc.constantFrom("..", ".", "%2e%2e", "%00", "%5c", ".secret", "sub", "outdir", "evil.txt", "index.html", "x"), {
        minLength: 1,
        maxLength: 5,
      })
      .map((a) => "/" + a.join("/"));
    await fc.assert(
      fc.asyncProperty(rawArb, async (raw) => {
        const r = await send("GET", raw);
        expect([200, 404]).toContain(r.status);
        if (r.status === 200) {
          expect(r.body).not.toContain("outside secret");
          expect(r.body).not.toContain("dotfile");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("rejects specific hostile paths", async () => {
    const hostile = [
      "/../outside/secret.txt", "/%2e%2e/outside/secret.txt", "/sub/../index.html", "/./index.html",
      "/a%00b", "/sub%5cindex.html", "/sub\\index.html", "/.secret", "/.hidden/a.txt", "/sub/", "/sub",
      "//index.html", "/%", "/%zz", "index.html", "/C:/Windows/win.ini", "/%252e%252e/x",
    ];
    for (const raw of hostile) {
      expect(await resolveStaticPath(raw, root), raw).toBeNull();
    }
  });

  it("never serves a directory (no listing)", async () => {
    for (const p of ["/sub", "/sub/", "/outdir", "/outdir/"]) {
      const r = await send("GET", p);
      expect(r.status, p).toBe(404);
      expect(r.headers["content-type"]).toContain("application/json");
    }
  });

  it("does not follow a file symlink out of the root", async () => {
    if (!fileSymlinkWorks) {
      // Explicit, visible handling: symlink creation is not permitted here, so the link was never planted.
      console.warn("static.test: file symlink creation not permitted on this platform; link test not exercised");
      expect(fileSymlinkWorks).toBe(false);
      expect(await resolveStaticPath("/evil.txt", root)).toBeNull();
      return;
    }
    expect(await resolveStaticPath("/evil.txt", root)).toBeNull();
    const r = await send("GET", "/evil.txt");
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("outside secret");
  });

  it("does not follow a directory link out of the root", async () => {
    if (!dirLinkWorks) {
      console.warn("static.test: directory link creation not permitted on this platform; link test not exercised");
      expect(dirLinkWorks).toBe(false);
      expect(await resolveStaticPath("/outdir/secret.txt", root)).toBeNull();
      return;
    }
    expect(await resolveStaticPath("/outdir/secret.txt", root)).toBeNull();
    const r = await send("GET", "/outdir/secret.txt");
    expect(r.status).toBe(404);
  });
});

describe("static serving examples", () => {
  it("serves / as index.html", async () => {
    const r = await send("GET", "/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("<title>x</title>");
  });

  it("sets Content-Type per extension", async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["/index.html", "text/html; charset=utf-8"],
      ["/style.css", "text/css; charset=utf-8"],
      ["/app.js", "text/javascript; charset=utf-8"],
      ["/data.json", "application/json; charset=utf-8"],
      ["/logo.svg", "image/svg+xml; charset=utf-8"],
      ["/notes.txt", "text/plain; charset=utf-8"],
      ["/blob.bin", "application/octet-stream"],
    ];
    for (const [p, type] of cases) {
      const r = await send("GET", p);
      expect(r.status, p).toBe(200);
      expect(r.headers["content-type"], p).toBe(type);
    }
  });

  it("maps png, ico, woff2 and unknown extensions", () => {
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.ico")).toBe("image/x-icon");
    expect(contentTypeFor("a.woff2")).toBe("font/woff2");
    expect(contentTypeFor("a.exe")).toBe("application/octet-stream");
    expect(contentTypeFor("a.constructor")).toBe("application/octet-stream");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
  });

  it("HEAD returns the GET headers and no body", async () => {
    const get = await send("GET", "/app.js");
    const head = await send("HEAD", "/app.js");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(get.body)));
  });

  it("answers 405 with Allow for other methods", async () => {
    for (const m of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const r = await send(m, "/index.html");
      expect(r.status, m).toBe(405);
      expect(r.headers["allow"], m).toBe("GET, HEAD");
    }
  });

  it("uses no-cache for index.html and a max-age for other files", async () => {
    expect((await send("GET", "/")).headers["cache-control"]).toBe("no-cache");
    expect((await send("GET", "/index.html")).headers["cache-control"]).toBe("no-cache");
    expect((await send("GET", "/app.js")).headers["cache-control"]).toBe("public, max-age=3600");
    expect((await send("GET", "/sub/index.html")).headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("ignores the query string when resolving", async () => {
    expect((await send("GET", "/app.js?v=1")).status).toBe(200);
  });

  it("the real placeholder public/index.html names the app and has no script", async () => {
    const html = await readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
    expect(html).toContain("Necromancer");
    expect(html.toLowerCase()).not.toContain("<script");
  });
});
