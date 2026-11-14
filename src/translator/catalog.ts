import { readRepoText } from "./files.js";
import { extractCurseMarkers } from "./markers.js";
import { deepFreeze, SAMPLE_DATA } from "./sample-data.js";
import { getTranslationModule } from "./translations/registry.js";
import { SAMPLE_IDS, VARIANTS } from "./types.js";
import type { Sample, SampleId, Translation, Variant } from "./types.js";

// Read-only catalog API. It only builds data: it never runs the engine, a Candidate or the Oracle.

const sampleCache = new Map<SampleId, Sample>();
const translationCache = new Map<string, Translation>();

function describe(value: unknown): string {
  return String(value);
}

function assertSampleId(value: unknown): asserts value is SampleId {
  if (typeof value !== "string" || !SAMPLE_IDS.some((id) => id === value)) {
    throw new Error(`Unknown sample id "${describe(value)}". Valid ids: ${SAMPLE_IDS.join(", ")}`);
  }
}

function assertVariant(value: unknown): asserts value is Variant {
  if (typeof value !== "string" || !VARIANTS.some((variant) => variant === value)) {
    throw new Error(
      `Unknown variant "${describe(value)}". Valid variants: ${VARIANTS.join(", ")}`,
    );
  }
}

function buildSample(id: SampleId): Sample {
  const cobolSource = readRepoText(`cobol-samples/${id}.cbl`, `COBOL source for sample "${id}"`);
  return deepFreeze({ ...SAMPLE_DATA[id], cobolSource });
}

function buildTranslation(sampleId: SampleId, variant: Variant): Translation {
  const module = getTranslationModule(sampleId, variant);
  const source = readRepoText(
    `src/translator/translations/${sampleId}.${variant}.ts`,
    `translation source for "${sampleId}/${variant}"`,
  );
  return deepFreeze({
    sampleId,
    variant,
    candidate: module.candidate,
    provenance: { ...module.provenance },
    source,
    markers: extractCurseMarkers(source).map((marker) => ({ ...marker })),
  });
}

export function getSample(id: SampleId): Sample {
  assertSampleId(id);
  const cached = sampleCache.get(id);
  if (cached !== undefined) return cached;
  const built = buildSample(id);
  sampleCache.set(id, built);
  return built;
}

export function listSamples(): readonly Sample[] {
  return SAMPLE_IDS.map((id) => getSample(id));
}

export function getTranslation(sampleId: SampleId, variant: Variant): Translation {
  assertSampleId(sampleId);
  assertVariant(variant);
  const key = `${sampleId}/${variant}`;
  const cached = translationCache.get(key);
  if (cached !== undefined) return cached;
  const built = buildTranslation(sampleId, variant);
  translationCache.set(key, built);
  return built;
}
