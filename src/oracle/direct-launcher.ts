import { spawn, type ChildProcess } from "node:child_process";
import type { OracleConfig } from "./config.js";
import type { WorkerLauncher, WorkerTransport } from "./worker-client.js";

/** Base64 JSON of the sandbox policy, passed once on the command line. */
export function encodePolicy(cfg: OracleConfig): string {
  return Buffer.from(JSON.stringify(cfg.sandbox), "utf8").toString("base64");
}

/** Wraps a child process with piped stdio as a WorkerTransport. */
export function childToTransport(child: ChildProcess): WorkerTransport {
  const { stdin, stdout } = child;
  if (stdin === null || stdout === null) {
    throw new Error("worker child was started without piped stdio");
  }
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("error", () => resolve({ code: null, signal: null }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  // Broken pipes surface as exit/EOF; avoid unhandled 'error' events.
  stdin.on("error", () => undefined);
  return {
    stdin: {
      write: (chunk: Buffer): boolean => stdin.write(chunk),
      end: (): void => {
        stdin.end();
      },
    },
    stdout: stdout as AsyncIterable<Buffer>,
    exited,
    kill: (): void => {
      child.kill("SIGKILL");
    },
  };
}

/** Used when already inside the Oracle_Image: runs the Worker as a direct child. */
export class DirectLauncher implements WorkerLauncher {
  launch(cfg: OracleConfig): Promise<WorkerTransport> {
    const [command, ...args] = cfg.workerCommand;
    if (command === undefined) {
      return Promise.reject(new Error("workerCommand is empty"));
    }
    return new Promise<WorkerTransport>((resolve, reject) => {
      const child = spawn(command, [...args, "--policy", encodePolicy(cfg)], {
        stdio: ["pipe", "pipe", "inherit"],
        shell: false,
      });
      child.once("error", (err) => {
        reject(new Error(`cannot start worker command '${command}': ${err.message}`));
      });
      child.once("spawn", () => {
        try {
          resolve(childToTransport(child));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }
}
