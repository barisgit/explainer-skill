/* Spike: gzipped bytes a packed page ships for charts. TanStack Charts entries are bundled and minified as pack would (Preact
   left external, since every page with a client component already carries it); ECharts and plot.js are the kit files pack inlines.
   bun spike/size.ts */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = join(import.meta.dir, "..");
const KIT = join(ROOT, "skills/explainer/kit");
const gz = (text: string) => gzipSync(text, { level: 9 }).length;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** What each entry imports: the marks and extensions the ported figures use. */
const ENTRIES: Record<string, string> = {
	"TanStack: stem plot (link, dot, text, ruleY, linear, tooltip) + Preact adapter": `
		export { defineChart, dot, link, ruleY, text } from "@tanstack/charts";
		export { scaleLinear } from "@tanstack/charts/scales/linear";
		export { tooltip } from "@tanstack/charts/tooltip";
		export { Chart } from "@tanstack/charts/preact";`,
	"TanStack: all four figures (+ areaY, lineY, barX, band, ordinal, crosshair)": `
		export { areaY, barX, defineChart, dot, link, lineY, ruleX, ruleY, text } from "@tanstack/charts";
		export { crosshair } from "@tanstack/charts/crosshair";
		export { scaleBand } from "@tanstack/charts/scales/band";
		export { scaleLinear } from "@tanstack/charts/scales/linear";
		export { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
		export { tooltip } from "@tanstack/charts/tooltip";
		export { Chart } from "@tanstack/charts/preact";`,
	"TanStack: + interactive legend, zoomX, brushX (ECharts-like interactions)": `
		export { areaY, barX, defineChart, dot, link, lineY, ruleX, ruleY, text } from "@tanstack/charts";
		export { crosshair } from "@tanstack/charts/crosshair";
		export { controlledSignal } from "@tanstack/charts/interaction/signal";
		export { zoomX } from "@tanstack/charts/interaction/zoom";
		export { brushX } from "@tanstack/charts/interaction/brush";
		export { interactiveColorLegend } from "@tanstack/charts/legend";
		export { scaleBand } from "@tanstack/charts/scales/band";
		export { scaleLinear } from "@tanstack/charts/scales/linear";
		export { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
		export { tooltip } from "@tanstack/charts/tooltip";
		export { Chart } from "@tanstack/charts/preact";`,
	"TanStack: + sankey, treemap, force graph, log scale (d3-scale)": `
		export { areaY, barX, defineChart, dot, link, lineY, ruleX, ruleY, text } from "@tanstack/charts";
		export { tooltip } from "@tanstack/charts/tooltip";
		export { Chart } from "@tanstack/charts/preact";
		export * from "@tanstack/charts/network/sankey";
		export * from "@tanstack/charts/hierarchy/treemap";
		export * from "@tanstack/charts/network/force";
		export { scaleLog } from "d3-scale";`,
};

async function bundled(code: string): Promise<string> {
	const entry = join(ROOT, "spike/.size-entry.ts");
	const built = await Bun.build({
		entrypoints: [entry],
		files: { [entry]: code },
		minify: true,
		format: "esm",
		target: "browser",
		external: ["preact", "preact/*"],
	});
	const [output] = built.outputs;
	if (!output) {
		throw new Error("the build wrote nothing");
	}
	return output.text();
}

const kitScript = (name: string) =>
	new Bun.Transpiler({ loader: "ts", minifyWhitespace: true }).transformSync(
		readFileSync(join(KIT, name), "utf8"),
	);

const rows: [string, string][] = [];
for (const [name, code] of Object.entries(ENTRIES)) {
	const text = await bundled(code);
	rows.push([name, `${kb(text.length)} min, ${kb(gz(text))} gz`]);
}
const echarts = readFileSync(join(KIT, "echarts.js"), "utf8");
const charts = kitScript("charts.ts");
const plot = kitScript("plot.ts");
rows.push(["ECharts (kit/echarts.js)", `${kb(echarts.length)} min, ${kb(gz(echarts))} gz`]);
rows.push(["kit charts.js (Chart glue)", `${kb(charts.length)}, ${kb(gz(charts))} gz`]);
rows.push(["ECharts + charts.js", `${kb(gz(echarts + charts))} gz`]);
rows.push(["kit plot.js (Plot)", `${kb(plot.length)}, ${kb(gz(plot))} gz`]);
for (const [name, size] of rows) {
	console.log(`${name.padEnd(80)} ${size}`);
}
