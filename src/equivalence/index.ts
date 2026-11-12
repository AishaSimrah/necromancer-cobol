/** Public entry point of the equivalence engine. */
export { runEquivalence } from "./run.js";
export { INTEREST, PAYROLL, TAX } from "./descriptors.js";
export { EquivalenceConfigError } from "./errors.js";

export type { FieldDescriptor } from "./descriptors.js";
export type { EquivalenceReport, ProgressCallback } from "./report.js";
export type { EquivalenceOptions } from "./config.js";
export type { Candidate } from "./compare.js";
export type { EvidenceGroup } from "./classify.js";
export type { OraclePort } from "./oracle-port.js";
