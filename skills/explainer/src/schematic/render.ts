/**
 * A finished scene as one inline SVG: strokes and text in currentColor (theme.css sets it from the kit's tokens), each part a
 * <g data-ref> with its label, so prose can light it, and each named net's wires a <g data-ref> of their own.
 */
import { type Box, grow, type Point, union } from "./geometry.ts";
import type { PlacedLabel } from "./labels.ts";
import { extentOf, type Part, type Scene } from "./scene.ts";
import { FONT, LINE, runsOf, SUB, VALUE_FONT } from "./text.ts";

/** The most a drawing grows past its drawn size, as Mermaid diagrams do. */
const SCALE = 1.2;
/** The smallest text size, in px, the drawing may shrink to before its block scrolls sideways. */
const READABLE_PX = 10;
const MARGIN = 6;

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (n: number) => String(Math.round(n * 100) / 100);

/** A label line as SVG text: subscripts as smaller, lowered tspans. */
function textLine(line: string, at: Point, anchor: string, size: number, cls: string): string {
	const runs = runsOf(line)
		.map((run) =>
			run.sub
				? `<tspan font-size="${num(size * SUB)}" dy="3">${escapeHtml(run.text)}</tspan><tspan dy="-3"></tspan>`
				: escapeHtml(run.text),
		)
		.join("");
	const c = cls ? ` class="${cls}"` : "";
	return `<text x="${num(at.x)}" y="${num(at.y)}" text-anchor="${anchor}" font-size="${size}"${c}>${runs}</text>`;
}

function labelSvg(label: PlacedLabel): string {
	const x =
		label.anchor === "start"
			? label.box.x0
			: label.anchor === "end"
				? label.box.x1
				: (label.box.x0 + label.box.x1) / 2;
	return label.lines
		.map((line, i) =>
			textLine(
				line,
				{ x, y: label.box.y0 + (i + 1) * LINE - 3.5 },
				label.anchor,
				i ? VALUE_FONT : FONT,
				i ? "value" : "",
			),
		)
		.join("");
}

function transformOf(part: Part): string {
	const parts = [`translate(${num(part.at.x)} ${num(part.at.y)})`];
	if (part.o.rot) {
		parts.push(`rotate(${part.o.rot})`);
	}
	if (part.o.flip) {
		parts.push("scale(-1 1)");
	}
	return parts.join(" ");
}

function partSvg(part: Part, label: PlacedLabel | undefined): string {
	const hit = grow(extentOf(part), 3);
	const texts = (part.def.texts ?? [])
		.map((t) =>
			textLine(t.text, { x: t.at.x + part.at.x, y: t.at.y + part.at.y }, t.anchor, FONT, "pin"),
		)
		.join("");
	const fill = part.def.fill
		? `<path d="${part.def.fill}" fill="currentColor" stroke="none"/>`
		: "";
	return [
		`<g data-ref="${escapeHtml(part.id)}" data-kind="${part.kind}">`,
		`<rect class="hit" fill="transparent" x="${num(hit.x0)}" y="${num(hit.y0)}" width="${num(hit.x1 - hit.x0)}" height="${num(hit.y1 - hit.y0)}"/>`,
		`<g transform="${transformOf(part)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="${part.def.stroke}"/>${fill}</g>`,
		texts,
		label ? labelSvg(label) : "",
		"</g>",
	].join("");
}

function wiresSvg(scene: Scene, dots: Point[]): string {
	const byNet = new Map<string, string[]>();
	for (const w of scene.wires) {
		const d = w.points.map((p, i) => `${i ? "L" : "M"}${num(p.x)},${num(p.y)}`).join(" ");
		byNet.set(w.net, [...(byNet.get(w.net) ?? []), d]);
	}
	const nets = [...byNet].map(([net, ds]) => {
		const ref = scene.namedNets?.has(net) ? ` data-ref="${escapeHtml(net)}"` : "";
		return `<path${ref} class="wire" d="${ds.join(" ")}"/>`;
	});
	const dotSvg = dots.map(
		(d) => `<circle cx="${num(d.x)}" cy="${num(d.y)}" r="2.6" fill="currentColor" stroke="none"/>`,
	);
	return nets.join("") + dotSvg.join("");
}

/** The drawn box of the whole sheet: every part, wire and label. */
function sheetBox(scene: Scene, labels: PlacedLabel[]): Box {
	const wireBoxes = scene.wires.flatMap((w) =>
		w.points.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })),
	);
	return grow(
		union([...scene.parts.map(extentOf), ...wireBoxes, ...labels.map((l) => l.box)]),
		MARGIN,
	);
}

/** The smallest text size the drawing uses: a value's subscript if it has one. */
function smallestText(labels: PlacedLabel[]): number {
	const sizes = labels.flatMap((l) =>
		l.lines.flatMap((line, i) => {
			const size = i ? VALUE_FONT : FONT;
			return runsOf(line).map((run) => (run.sub ? size * SUB : size));
		}),
	);
	return Math.min(FONT, ...sizes);
}

/**
 * The SVG, sized like a Mermaid diagram: at most SCALE times its drawn width, and at least the width that keeps its smallest
 * text at READABLE_PX, below which its block scrolls sideways (theme.css reads both).
 */
export function renderSvg(
	scene: Scene,
	dots: Point[],
	labels: PlacedLabel[],
	title: string,
): string {
	const box = sheetBox(scene, labels);
	const w = box.x1 - box.x0;
	const h = box.y1 - box.y0;
	const most = Math.ceil(w * SCALE);
	const least = Math.min(most, Math.ceil((w * READABLE_PX) / smallestText(labels)));
	const byPart = new Map(labels.map((l) => [l.part, l]));
	return [
		`<svg class="schematic-svg" viewBox="${num(box.x0)} ${num(box.y0)} ${num(w)} ${num(h)}" width="100%"`,
		` style="--schematic-max: ${most}px; --schematic-min: ${least}px" fill="currentColor" role="img" aria-label="${escapeHtml(title)}">`,
		`<g class="wires" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${wiresSvg(scene, dots)}</g>`,
		scene.parts.map((p) => partSvg(p, byPart.get(p.id))).join(""),
		"</svg>",
	].join("");
}
