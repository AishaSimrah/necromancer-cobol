/**
 * Test double for ChildSpawner: returns scripted terminations in order and
 * records every SpawnSpec it receives.
 */

import type { ChildSpawner, ChildTermination, SpawnSpec } from "../../../src/oracle/worker/spawner.js";

export type ScriptedTermination =
  | Partial<ChildTermination>
  | ((spec: SpawnSpec) => Partial<ChildTermination> | Promise<Partial<ChildTermination>>);

const DEFAULT_TERMINATION: ChildTermination = {
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  exitCode: 0,
  signal: null,
  endedBy: "exit",
  truncated: false,
  durationMs: 0,
};

export class FakeSpawner implements ChildSpawner {
  /** Every spec received, in call order. */
  readonly specs: SpawnSpec[] = [];
  private readonly script: ScriptedTermination[];

  /** Script entries are consumed one per call; the last one repeats. */
  constructor(script: readonly ScriptedTermination[] = []) {
    this.script = [...script];
  }

  async run(spec: SpawnSpec): Promise<ChildTermination> {
    this.specs.push(spec);
    const index = this.specs.length - 1;
    const entry = this.script[Math.min(index, this.script.length - 1)];
    const partial =
      entry === undefined ? {} : typeof entry === "function" ? await entry(spec) : entry;
    return { ...DEFAULT_TERMINATION, ...partial };
  }
}
