import type { ProveRequest } from "../../server/wire.js";

export type Variant = ProveRequest["variant"];

export interface Selection {
  readonly sampleId: string;
  readonly variant: Variant;
}
