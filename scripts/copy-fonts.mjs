import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const destDir = join(root, "public", "fonts");

const fonts = [
  ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-400.woff2"],
  ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2", "jetbrains-mono-700.woff2"],
  ["@fontsource/cinzel/files/cinzel-latin-400-normal.woff2", "cinzel-400.woff2"],
];

const jobs = fonts.map(([src, name]) => [join(root, "node_modules", src), join(destDir, name)]);

for (const [src] of jobs) {
  if (!existsSync(src)) {
    process.stderr.write(`Missing font file: ${src}\n`);
    process.exit(1);
  }
}

mkdirSync(destDir, { recursive: true });
for (const [src, dest] of jobs) {
  copyFileSync(src, dest);
}
process.stdout.write(`Copied ${jobs.length} fonts to ${destDir}\n`);
