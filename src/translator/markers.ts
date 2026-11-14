import type { CurseMarker } from "./types.js";

/** Finds `// CURSE:<id>` markers; line numbers are 1-based. */
export function extractCurseMarkers(source: string): readonly CurseMarker[] {
  const markers: CurseMarker[] = [];
  const lines = source.split(/\r\n|\r|\n/);
  lines.forEach((text, index) => {
    const pattern = /\/\/\s*CURSE:([a-z0-9-]+)/g;
    for (const match of text.matchAll(pattern)) {
      const curseId = match[1];
      if (curseId !== undefined) {
        markers.push({ curseId, line: index + 1 });
      }
    }
  });
  return markers;
}
