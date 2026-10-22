#!/usr/bin/env bun
/**
 * Regenerates the vendored libraries from the pinned devDependencies:
 * (paths inside skills/explainer)
 *   kit/echarts.js                custom ECharts bundle (build/echarts-entry.ts), minified, one script tag
 *   vendor/beautiful-mermaid.js   beautiful-mermaid with ELK and entities, one ES module; used by `pack` to render diagrams, never inlined
 *   kit/licenses/*.txt            licence texts the bundles must carry
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const skill = join(root, "skills", "explainer");
const nm = (...p: string[]) => join(root, "node_modules", ...p);
const text = (...p: string[]) => Bun.file(nm(...p)).text();
const versionOf = async (pkg: string): Promise<string> =>
	(await Bun.file(nm(pkg, "package.json")).json()).version;

/** Bundles one entry and returns its single output file's text. */
async function bundle(entry: string, target: "browser" | "bun", format: "iife" | "esm") {
	const built = await Bun.build({ entrypoints: [entry], minify: true, target, format });
	const [output] = built.outputs;
	if (!(built.success && output)) {
		throw new Error(`${entry}: ${built.logs.join("\n")}`);
	}
	return output.text();
}

const echartsHeader = `/* echarts: Apache ECharts ${await versionOf("echarts")}, custom build, global echarts.
   Charts: line bar scatter pie heatmap treemap sankey sunburst radar boxplot. Components: grid polar radar calendar axisPointer tooltip legend
   dataZoom brush toolbox visualMap markLine/Area/Point title dataset transform aria. Features: label layout, universal transition. Canvas renderer.
   Apache-2.0, licenses/echarts.txt. Rebuild with: bun run vendor */\n`;
writeFileSync(
	join(skill, "kit/echarts.js"),
	echartsHeader + (await bundle(join(import.meta.dir, "echarts-entry.ts"), "browser", "iife")),
);

// The minifier drops ELK's own notice comments, so the header restates them (EPL-2.0 section 3.3) and points at the licence files.
const [bm, elk, entities] = await Promise.all(
	["beautiful-mermaid", "elkjs", "entities"].map(versionOf),
);
const mermaidHeader = `/*! beautiful-mermaid ${bm} (MIT, Copyright (c) 2026 Craft Docs) with patches/beautiful-mermaid@${bm}.patch, bundled with
   elkjs ${elk} (EPL-2.0, Copyright (c) 2017, 2021 Kiel University and others; source: https://github.com/kieler/elkjs/tree/${elk},
   which builds on https://github.com/eclipse/elk) and entities ${entities} (BSD-2-Clause, Copyright (c) Felix Böhm).
   Each component keeps its own licence; this file as a whole is not MIT. Texts: kit/licenses/beautiful-mermaid.txt, elkjs.txt, entities.txt.
   Exports renderMermaidSVG and parseMermaid. Rebuild with: bun run vendor */\n`;
mkdirSync(join(skill, "vendor"), { recursive: true });
writeFileSync(
	join(skill, "vendor/beautiful-mermaid.js"),
	mermaidHeader + (await bundle(join(import.meta.dir, "beautiful-mermaid-entry.ts"), "bun", "esm")),
);

mkdirSync(join(skill, "kit/licenses"), { recursive: true });
const licences: Record<string, Promise<string>[]> = {
	"echarts.txt": [text("echarts", "LICENSE"), text("echarts", "NOTICE")],
	"beautiful-mermaid.txt": [text("beautiful-mermaid", "LICENSE")],
	// EPL-2.0 section 3.1(a): the object code must say where its source is available under the same licence.
	"elkjs.txt": [
		Promise.resolve(
			`elkjs ${elk}, Copyright (c) 2017, 2021 Kiel University and others.\nSPDX-License-Identifier: EPL-2.0\n\nvendor/beautiful-mermaid.js contains elkjs ${elk} (lib/elk.bundled.js) in minified form, unmodified.\nIts Source Code is available under the Eclipse Public License 2.0 at https://github.com/kieler/elkjs/tree/${elk}\n(the npm package elkjs@${elk}), and the Java sources it is compiled from at https://github.com/eclipse/elk.`,
		),
		text("elkjs", "LICENSE.md"),
	],
	"entities.txt": [text("entities", "LICENSE")],
};
for (const [file, parts] of Object.entries(licences)) {
	writeFileSync(join(skill, "kit/licenses", file), (await Promise.all(parts)).join("\n\n"));
}

for (const f of ["kit/echarts.js", "vendor/beautiful-mermaid.js"]) {
	console.log(`${f} ${(statSync(join(skill, f)).size / 1024).toFixed(0)} KB`);
}
