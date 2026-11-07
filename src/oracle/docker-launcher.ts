import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { OracleConfig } from "./config.js";
import { childToTransport, encodePolicy } from "./direct-launcher.js";
import type { WorkerLauncher, WorkerTransport } from "./worker-client.js";

const INSPECT_TIMEOUT_MS = 15_000;

interface ExecResult {
  readonly error: { readonly code?: string | number | null } | null;
  readonly stderr: string;
}

function inspectImage(image: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      ["image", "inspect", "--format", "{{.Id}}", image],
      { timeout: INSPECT_TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) => {
        resolve({ error, stderr: String(stderr) });
      },
    );
  });
}

/** Arguments for `docker run`, as an array (never passed through a shell). */
export function buildDockerRunArgs(cfg: OracleConfig, name: string): string[] {
  return [
    "run",
    "-i",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--memory",
    "1g",
    "--pids-limit",
    "256",
    "--read-only",
    "--tmpfs",
    "/work:rw,exec,nosuid,size=256m",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "SETUID",
    "--cap-add",
    "SETGID",
    "--cap-add",
    "CHOWN",
    "--cap-add",
    "DAC_OVERRIDE",
    "--cap-add",
    "FOWNER",
    "--cap-add",
    "KILL",
    "--security-opt",
    "no-new-privileges",
    cfg.imageName,
    ...cfg.workerCommand,
    "--policy",
    encodePolicy(cfg),
  ];
}

export class DockerLauncher implements WorkerLauncher {
  async launch(cfg: OracleConfig): Promise<WorkerTransport> {
    const { error, stderr } = await inspectImage(cfg.imageName);
    if (error !== null) {
      if (error.code === "ENOENT") {
        throw new Error("Docker is not installed or not on PATH (command 'docker' not found)");
      }
      if (/cannot connect|daemon|pipe|is the docker/i.test(stderr)) {
        throw new Error(
          `Docker daemon is not running or not reachable: ${stderr.trim().slice(0, 200)}`,
        );
      }
      throw new Error(
        `Docker image '${cfg.imageName}' is missing (build the Oracle_Image first): ${stderr
          .trim()
          .slice(0, 200)}`,
      );
    }

    const name = `necromancer-oracle-${randomBytes(6).toString("hex")}`;
    return new Promise<WorkerTransport>((resolve, reject) => {
      const child = spawn("docker", buildDockerRunArgs(cfg, name), {
        stdio: ["pipe", "pipe", "inherit"],
        shell: false,
        windowsHide: true,
      });
      child.once("error", (err) => {
        reject(new Error(`cannot start Docker: ${err.message}`));
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
