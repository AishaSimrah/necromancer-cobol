export type DecorationKind = "skeleton" | "ghost-a" | "ghost-b" | "verdict-ghost" | "smoke" | "fog";

export function decorationAttrs(kind: DecorationKind): Readonly<Record<string, string>> {
  const common: Record<string, string> = {
    "aria-hidden": "true",
    "data-decoration": kind,
    class: `decor decor-${kind}`,
  };
  if (kind === "fog") {
    return common;
  }
  return { src: `/decor/${kind}.svg`, alt: "", ...common };
}
