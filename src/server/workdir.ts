import { promises as nodeFs, constants as fsConstants } from "node:fs";
import type { ServerLogger } from "./types.js";

/** The fs operations prepareWorkRoot needs. Tests fake them. */
export interface WorkdirFsPort {
  mkdir(path: string, opts: { recursive: true; mode: number }): Promise<unknown>;
  writeFile(path: string, data: string, opts: { mode: number }): Promise<void>;
  access(path: string, mode: number): Promise<void>;
  rm(path: string, opts: { force: true }): Promise<void>;
}

export interface WorkRootStatus {
  readonly execAllowed: boolean;
}

export const realWorkdirFs: WorkdirFsPort = {
  mkdir: (p, o) => nodeFs.mkdir(p, o),
  writeFile: (p, d, o) => nodeFs.writeFile(p, d, o),
  access: (p, m) => nodeFs.access(p, m),
  rm: (p, o) => nodeFs.rm(p, o),
};

const DIR_MODE = 0o700;
const CHECK_SCRIPT = "#!/bin/sh\nexit 0\n";

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code: unknown = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function joinPath(root: string, name: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.endsWith(sep) ? `${root}${name}` : `${root}${sep}${name}`;
}

async function ensureDir(workRoot: string, fsPort: WorkdirFsPort): Promise<void> {
  try {
    await fsPort.mkdir(workRoot, { recursive: true, mode: DIR_MODE });
  } catch (err) {
    throw new Error(`cannot create work root ${workRoot}: ${errorCode(err)}`, { cause: err });
  }
}

async function writeCheckFile(file: string, workRoot: string, fsPort: WorkdirFsPort): Promise<void> {
  try {
    await fsPort.writeFile(file, CHECK_SCRIPT, { mode: DIR_MODE });
  } catch (err) {
    throw new Error(`cannot write to ${workRoot}: ${errorCode(err)}`, { cause: err });
  }
}

async function canExecute(file: string, fsPort: WorkdirFsPort): Promise<boolean> {
  try {
    await fsPort.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeBestEffort(file: string, fsPort: WorkdirFsPort): Promise<void> {
  try {
    await fsPort.rm(file, { force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Creates the work root (0700) and checks that files there can be executed.
 * Never executes the check file. Creates no other directory.
 */
export async function prepareWorkRoot(
  workRoot: string,
  fsPort: WorkdirFsPort,
  logger: ServerLogger,
  pid: number = process.pid,
): Promise<WorkRootStatus> {
  await ensureDir(workRoot, fsPort);
  const file = joinPath(workRoot, `.necro-check-${pid}`);
  await writeCheckFile(file, workRoot, fsPort);
  const execAllowed = await canExecute(file, fsPort);
  if (!execAllowed) {
    logger.line(`work root ${workRoot} does not allow executing files (noexec mount?)`);
  }
  await removeBestEffort(file, fsPort);
  return { execAllowed };
}
