import { DirectLauncher } from "./direct-launcher.js";
import { DockerLauncher } from "./docker-launcher.js";
import type { WorkerLauncher } from "./worker-client.js";

/** Direct mode when already inside the Oracle_Image, Docker mode otherwise. */
export function selectLauncher(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerLauncher {
  return env["NECROMANCER_IN_ORACLE_IMAGE"] === "1" ? new DirectLauncher() : new DockerLauncher();
}
