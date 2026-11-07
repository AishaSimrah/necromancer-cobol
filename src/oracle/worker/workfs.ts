/**
 * Work filesystem: handle directories and the COBOL source file.
 * Phase A scope: mkdtemp, write prog.cob, non-throwing recursive removal.
 * Task 5.1 extends this with ownership, modes and scratch directories.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../config.js";

export const SOURCE_FILE = "prog.cob";
export const PROGRAM_FILE = "prog";

export interface WorkFs {
  /** Creates a unique handle directory under the work root; returns its path. */
  createHandleDir(): Promise<string>;
  /** Writes the COBOL source to `<dir>/prog.cob`; returns the file path. */
  writeSource(dir: string, source: string): Promise<string>;
  /** Removes a directory recursively. Logs failures, never throws. */
  removeDir(dir: string): Promise<void>;
}

export class RealWorkFs implements WorkFs {
  constructor(
    private readonly root: string,
    private readonly logger: Logger,
  ) {}

  createHandleDir(): Promise<string> {
    return mkdtemp(join(this.root, "h-"));
  }

  async writeSource(dir: string, source: string): Promise<string> {
    const path = join(dir, SOURCE_FILE);
    await writeFile(path, source, { encoding: "utf8", mode: 0o600 });
    return path;
  }

  async removeDir(dir: string): Promise<void> {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      this.logger.error("failed to remove work directory", {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
