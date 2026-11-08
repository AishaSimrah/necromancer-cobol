/**
 * Thrown (as a rejected promise from the run) for invalid descriptors or options,
 * before any Oracle call. Lives in its own module so descriptors.ts and config.ts
 * can both import it without a runtime import cycle.
 */
export class EquivalenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EquivalenceConfigError";
  }
}
