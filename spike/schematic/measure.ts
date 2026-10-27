/**
 * Spike harness for issue #71: renders every ```schematic fence of the given pages, prints what the comparison measures (author
 * source size, problems, wire statistics, render time, SVG size) and writes each SVG, a standalone light and dark copy of it
 * (`<name>-light.svg`, `<name>-dark.svg`, for previews outside a page) and measure.json into the output directory. Usage: bun spike/schematic/measure.ts <out-dir> <page.mdx>...
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { renderSchematic } from "../../skills/explainer/src/schematic/index.ts";

const [out = ".evidence/schematic", ...pages] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const rows: Record<string, unknown>[] = [];

for (const page of pages) {
	const text = readFileSync(page, "utf8");
	const fences = [...text.matchAll(/```schematic\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? "");
	fences.forEach((source, i) => {
		const name = `${basename(dirname(page))}-${i + 1}`;
		renderSchematic(source); // warm-up: the first ELK call starts its worker
		const t0 = performance.now();
		const result = renderSchematic(source);
		const ms = performance.now() - t0;
		const body = source.split("\n").slice(1);
		writeFileSync(join(out, `${name}.svg`), result.svg);
		for (const [scheme, ink, bg] of [
			["light", "#1c1915", "#f7f4ee"],
			["dark", "#eee8de", "#141210"],
		]) {
			const doc = result.svg
				.replace(/width="100%"/, 'width="900"')
				.replace(
					/style="[^"]*"/,
					`style="color:${ink};background:${bg};font-family:Geist,Helvetica"`,
				);
			writeFileSync(
				join(out, `${name}-${scheme}.svg`),
				`<?xml version="1.0"?>${doc.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')}`,
			);
		}
		rows.push({
			name,
			layout: result.stats.layout,
			lines: body.filter((l) => l.trim()).length,
			chars: body.join("\n").length,
			problems: result.problems.length,
			parts: result.stats.parts,
			nets: result.stats.nets,
			segments: result.stats.segments,
			bends: result.stats.bends,
			crossings: result.stats.crossings,
			wire: result.stats.length,
			ms: Math.round(ms * 10) / 10,
			svgBytes: result.svg.length,
		});
		for (const p of result.problems) {
			console.log(`  ${name}: ${p}`);
		}
	});
}
console.table(rows);
writeFileSync(join(out, "measure.json"), JSON.stringify(rows, null, "\t"));
