import * as realOracle from "../oracle/index.js";

export type { CompiledHandle, RunResult, Status } from "../oracle/index.js";

/** The slice of the oracle the equivalence engine depends on. */
export type OraclePort = Pick<
  typeof realOracle,
  "compileCobol" | "runCompiled" | "releaseHandle" | "isCompiledHandle"
>;

/** Default port backed by the real GnuCOBOL oracle. */
export const defaultOracle: OraclePort = {
  compileCobol: realOracle.compileCobol,
  runCompiled: realOracle.runCompiled,
  releaseHandle: realOracle.releaseHandle,
  isCompiledHandle: realOracle.isCompiledHandle,
};
