import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderWithPele } from "../build/mermaid-pele.ts";
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

/** Where each arrowhead points: the end of an edge drawn with one (current renderer), or a pele marker's tip. */
function tips(svg: string): Point[] {
	const point = (xy = "") => {
		const [x = 0, y = 0] = xy.split(",").map(Number);
		return { x, y };
	};
	const polylines = [
		...svg.matchAll(/<polyline class="edge"[^>]*data-arrow-end="true"[^>]*points="([^"]+)"/g),
	].map(([, points = ""]) => point(points.trim().split(" ").at(-1)));
	const markers = [...svg.matchAll(/<path class="pele-marker" d="M([\d.-]+,[\d.-]+)/g)].map(
		([, xy]) => point(xy),
	);
	return [...polylines, ...markers];
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

/** The flowchart and state fixtures whose drawing by `render` has crowded arrowheads. */
const crowdedFixtures = (render: (source: string) => Diagram | Error) =>
	flows.filter(({ source }) => crowded(drawn(render(source)).svg) > 0).map(({ name }) => name);

// Documents the owner's 2026-11-27 report: high fan-in stacks arrowheads a few px apart at the target's side (today 01, 03,
// 05 and 08). Drop .failing once the renderer draws them apart.
test.failing("current renderer (beautiful-mermaid with ELK) draws every arrowhead apart or shared", () => {
	expect(crowdedFixtures(renderMermaid)).toEqual([]);
});

describe("pele prototype (build/mermaid-pele.ts)", () => {
	test("draws every arrowhead apart or shared", () => {
		expect(crowdedFixtures((source) => renderWithPele(source))).toEqual([]);
	});

	test.each(fixtures.map(({ name, source }) => [name, source]))(
		"%s keeps every ref the current renderer gives",
		(_, source) => {
			const current = drawn(renderMermaid(source)).refs;
			const pele = new Set(drawn(renderWithPele(source)).refs);
			expect(current.filter((ref) => !pele.has(ref))).toEqual([]);
		},
	);

	test("a number tag is drawn inside its node, which grows to hold it", () => {
		const source = "flowchart LR\n  inv[Inverter] --> out[Output]";
		const plain = drawn(renderWithPele(source)).svg;
		const tagged = drawn(renderWithPele(source, 0, "tag:inv=2")).svg;
		expect(tagged).toContain('<g class="tag" data-id="inv" data-ref="inv" data-tag');
		const width = (svg: string) =>
			Number(/data-id="inv"[\s\S]*?<rect[^>]* width="([\d.]+)"/.exec(svg)?.[1]);
		expect(width(tagged)).toBeGreaterThan(width(plain) + 20);
	});

	test("a wide flowchart gets a narrower phone copy laid out across it", () => {
		const wide = fixtures.find(({ name }) => name.includes("wide-lr"));
		const diagram = drawn(renderWithPele(wide?.source ?? ""));
		const width = (svg = "") => Number(/ width="([\d.]+)"/.exec(svg)?.[1]);
		expect(width(diagram.phone)).toBeLessThan(width(diagram.svg));
	});
});
