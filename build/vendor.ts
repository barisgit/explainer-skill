#!/usr/bin/env bun
/**
 * Regenerates the vendored libraries from the pinned devDependencies:
 * (paths inside skills/explainer)
 *   kit/echarts.js          custom ECharts bundle (build/echarts-entry.ts), minified, one script tag
 *   vendor/mermaid.min.js   Mermaid's own IIFE build; used by `pack` to pre-render diagrams, never inlined
 *   kit/licenses/*.txt      licence texts the bundles must carry
 */
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const skill = join(root, "skills", "explainer");
const nm = (...p: string[]) => join(root, "node_modules", ...p);

const built = await Bun.build({
	entrypoints: [join(import.meta.dir, "echarts-entry.ts")],
	minify: true,
	target: "browser",
	format: "iife",
});
if (!built.success) throw new Error(built.logs.join("\n"));
const version = (await Bun.file(nm("echarts/package.json")).json()).version;
const header = `/* echarts: Apache ECharts ${version}, custom build, global echarts.
   Charts: line bar scatter pie heatmap treemap sankey sunburst radar boxplot. Components: grid polar radar calendar axisPointer tooltip legend
   dataZoom brush toolbox visualMap markLine/Area/Point title dataset transform aria. Features: label layout, universal transition. Canvas renderer.
   Apache-2.0, licenses/echarts.txt. Rebuild with: bun run vendor */\n`;
writeFileSync(join(skill, "kit/echarts.js"), header + (await built.outputs[0]!.text()));

mkdirSync(join(skill, "kit/licenses"), { recursive: true });
const echartsLicense = ["LICENSE", "NOTICE"].map((f) => Bun.file(nm("echarts", f)).text());
writeFileSync(
	join(skill, "kit/licenses/echarts.txt"),
	(await Promise.all(echartsLicense)).join("\n\n"),
);
copyFileSync(nm("mermaid/LICENSE"), join(skill, "kit/licenses/mermaid.txt"));
copyFileSync(nm("mermaid/dist/mermaid.min.js"), join(skill, "vendor/mermaid.min.js"));

for (const f of ["kit/echarts.js", "vendor/mermaid.min.js"])
	console.log(`${f} ${(statSync(join(skill, f)).size / 1024).toFixed(0)} KB`);
