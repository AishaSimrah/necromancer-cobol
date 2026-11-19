import type { FieldDescriptor } from "../equivalence/descriptors.js";
import type { Curse, ExamplePair, Sample, Translation, Variant } from "../translator/types.js";
import type {
  CurseWire,
  ExampleWire,
  FieldWire,
  SampleDetail,
  SampleSummary,
  TranslationWire,
} from "./wire.js";

/** Explicit allowlist mappers: new object literals with named keys, no spreads. */

const TRANSLATION_ORDER: readonly Variant[] = ["correct", "subtle", "naive"];

function toFieldWire(f: FieldDescriptor): FieldWire {
  return { name: f.name, digits: f.digits, scale: f.scale, signed: f.signed };
}

function toCurseWire(c: Curse): CurseWire {
  return { id: c.id, label: c.label, lines: [...c.lines] };
}

function toExampleWire(e: ExamplePair): ExampleWire {
  return { input: [...e.input], output: e.output };
}

function toTranslationWire(t: Translation): TranslationWire {
  return {
    variant: t.variant,
    source: t.source,
    provenance: {
      label: t.provenance.label,
      generatedWith: t.provenance.generatedWith,
      date: t.provenance.date,
    },
    markers: t.markers.map((m) => ({ curseId: m.curseId, line: m.line })),
  };
}

export function toSampleSummary(sample: Sample): SampleSummary {
  return {
    id: sample.id,
    name: sample.name,
    trapLabel: sample.trapLabel,
    defaultInput: [...sample.defaultInput],
  };
}

export function toSampleDetail(sample: Sample, translations: readonly Translation[]): SampleDetail {
  const ordered: TranslationWire[] = [];
  for (const variant of TRANSLATION_ORDER) {
    const t = translations.find((x) => x.variant === variant);
    if (t !== undefined) ordered.push(toTranslationWire(t));
  }
  return {
    id: sample.id,
    name: sample.name,
    trapLabel: sample.trapLabel,
    defaultInput: [...sample.defaultInput],
    cobolSource: sample.cobolSource,
    fields: sample.fields.map(toFieldWire),
    curses: sample.curses.map(toCurseWire),
    fidelityPact: [...sample.fidelityPact],
    examples: sample.examples.map(toExampleWire),
    translations: ordered,
  };
}
