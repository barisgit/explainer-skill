import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Diagram, renderMermaid } from "../skills/explainer/src/mermaid.ts";

const DIR = join(import.meta.dir, "fixtures/mermaid-stress");
const fixtures = readdirSync(DIR)
	.filter((file) => file.endsWith(".mmd"))
	.sort()
	.map((file) => ({
		name: file.replace(/\.mmd$/, ""),
		source: readFileSync(join(DIR, file), "utf8"),
	}));
const flows = fixtures.filter(({ source }) =>
	/^\s*(?:flowchart|stateDiagram)/m.test(source.replace(/^%%.*$/gm, "")),
);

/** Two arrowheads this close overlap at 13 px: they read as one smudge, not as separate edges. */
const DISTINCT_PX = 8;

type Point = { x: number; y: number };

/** Where each arrowhead points: its marker path's first point, the tip. */
function tips(svg: string): Point[] {
	return [...svg.matchAll(/<path class="pele-marker" d="M([\d.-]+),([\d.-]+)/g)].map(
		([, x, y]) => ({
			x: Number(x),
			y: Number(y),
		}),
	);
}

/** Pairs of arrowheads closer than DISTINCT_PX that do not coincide: a shared arrowhead counts as one. */
function crowded(svg: string): number {
	const all = tips(svg);
	let pairs = 0;
	for (const [i, a] of all.entries()) {
		for (const b of all.slice(i + 1)) {
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			pairs += distance > 0.5 && distance < DISTINCT_PX ? 1 : 0;
		}
	}
	return pairs;
}

const drawn = (diagram: Diagram | Error): Diagram => {
	if (diagram instanceof Error) {
		throw diagram;
	}
	return diagram;
};

// The owner's 2026-11-27 report: high fan-in stacked arrowheads a few px apart at the target's side (01, 03, 05 and 08 with
// beautiful-mermaid and ELK). Every copy pack draws keeps them apart or shares one.
test.each(flows.map(({ name, source }) => [name, source]))(
	"%s draws every arrowhead apart or shared, in both copies",
	(_, source) => {
		const { svg, phone } = drawn(renderMermaid(source));
		expect(tips(svg).length).toBeGreaterThan(0);
		expect([crowded(svg), crowded(phone ?? "")]).toEqual([0, 0]);
	},
);

test.each(fixtures.map(({ name, source }) => [name, source]))("%s draws", (_, source) => {
	expect(drawn(renderMermaid(source)).refs.length).toBeGreaterThan(0);
});
