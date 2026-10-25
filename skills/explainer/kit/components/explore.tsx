/* Explore: a slider, choice or toggles switching a plot or chart and its readout between frames computed in pack.
   <Explore label="Envelope against g(t)" controls={[{ id: "m", label: "Modulation index m", range: [0, 1.5, 0.05], value: 0.5 }]}
     frames={ms.map((m) => ({ plot: envelope(m), readout: `Envelope follows g(t): ${m <= 1 ? "yes" : "no"}` }))} />
     controls  one or more, each with a label and an id (a page with reply keeps its value across reloads):
       range: [min, max, step]   a slider; value is where it starts, format writes its readout ({ digits: 2 }, { unit: "%" })
       choice: ["LC", "SC"]      one of the texts, as a segmented switch; value is the text it starts on
       toggle: true              a switch, off then on; value: true starts it on
     frames    one frame per value of the first control; with more controls, a list per value nesting the next control's
               (two toggles: [[offOff, offOn], [onOff, onOn]]). A frame holds any of
       plot     a Plot option (kit Plot), or chart, a Chart option (kit Chart): JSON, with formats as JSON
       readout  text or JSX in a live line over the figure; stats { "Carrier": "67%" }, text or JSX, are figures in a row
       caption  text or JSX under the figure
     base      what every frame shares (axes, colours, the caption); a frame's keys merge over it
     label     the figure's accessible name
     class     more classes on the plot or chart, e.g. "tall"
   Frames are computed when the page packs; the page carries the first whole and each other one as its difference, with lines
   kept to 1/10000 of their range: 31 frames of two 201-point lines take about 90 KB, of four 1001-point lines about 900 KB.
   When that is too much, or the figure needs dragging, clicks or a simulation, write a client component. */
import { type ComponentChildren, Fragment, h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Explore as ExploreChart } from "./parts/explore-chart.tsx";
import { Explore as ExplorePlot } from "./parts/explore-plot.tsx";
import { Explore as ExploreText } from "./parts/explore-text.tsx";
import { type ExploreControl, type ExploreData, valueCount } from "./parts/explore-view.tsx";
import { numberText } from "./parts/format.ts";
import { diff, type Json } from "./parts/frames.ts";

/** One control as the page writes it. */
export type ExploreControlProps = { id: string; label: string } & (
	| { range: readonly [number, number, number]; value?: number; format?: NumberFormat }
	| { choice: readonly string[]; value?: string }
	| { toggle: true; value?: boolean }
);

/** One frame, or the shared base: what the figure shows for one combination of the controls' values. */
export interface ExploreFrame {
	plot?: PlotOption;
	chart?: ChartOption;
	readout?: ComponentChildren;
	stats?: Record<string, ComponentChildren>;
	caption?: ComponentChildren;
}

/** The frames, one list level per control. */
export type ExploreFrames = readonly (ExploreFrame | ExploreFrames)[];

export interface ExploreProps {
	controls: readonly ExploreControlProps[];
	frames: ExploreFrames;
	base?: ExploreFrame;
	label?: string;
	class?: string;
	id?: string;
}

/** A frame as the island gets it (explore-view.tsx): the figure's option as JSON, and HTML for the rest. */
interface Shown {
	figure?: Json;
	readout?: string;
	stats?: Record<string, string>;
	caption?: string;
}

const FRAME_KEYS = new Set(["plot", "chart", "readout", "stats", "caption"]);

const fail = (message: string): never => {
	throw new Error(`<Explore> ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Decimals a number is written with: 2 for 0.05. */
const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

/** The range's slider as the island gets it, its readout written in `format` for the page's lang. */
function rangeControl(id: string, [min, max, step]: readonly number[], format?: NumberFormat) {
	if (min === undefined || max === undefined || step === undefined || !(step > 0)) {
		return fail(`control "${id}": range is [min, max, step] with a step above 0`);
	}
	const count = Math.round((max - min) / step) + 1;
	if (count < 2 || Math.abs(min + (count - 1) * step - max) > step * 1e-6) {
		return fail(
			`control "${id}": range [${min}, ${max}, ${step}] needs max to be min plus whole steps`,
		);
	}
	const digits = Math.max(decimals(min), decimals(step));
	const text = numberText({ digits, ...format });
	const texts = Array.from({ length: count }, (_, i) => text(+(min + i * step).toFixed(digits)));
	return { range: { min, step, digits, texts } };
}

/** The control as the island gets it, and the index of the value it starts on. */
function control(spec: ExploreControlProps): { control: ExploreControl; start: number } {
	const { id, label } = spec;
	if (!id || !label) {
		return fail("every control needs an id, which keeps its value across reloads, and a label");
	}
	if ("range" in spec) {
		const shown = rangeControl(id, spec.range, spec.format);
		const { min, step, texts } = shown.range;
		const at = Math.round(((spec.value ?? min) - min) / step);
		return { control: { id, label, ...shown }, start: Math.min(Math.max(at, 0), texts.length - 1) };
	}
	if ("choice" in spec) {
		const start = spec.value === undefined ? 0 : spec.choice.indexOf(spec.value);
		if (spec.choice.length < 2 || start < 0) {
			return fail(`control "${id}": choice needs two or more texts, and value one of them`);
		}
		return { control: { id, label, choice: [...spec.choice] }, start };
	}
	if (spec.toggle !== true) {
		return fail(`control "${id}" needs range, choice or toggle: true`);
	}
	return { control: { id, label, toggle: true }, start: spec.value ? 1 : 0 };
}

/** The frames in row-major order with the path each has in the page's frames, checking one item per control value. */
function flatten(
	frames: unknown,
	controls: readonly ExploreControlProps[],
	counts: readonly number[],
	path = "frames",
): [string, ExploreFrame][] {
	const level = path.split("[").length - 1;
	const count = counts[level];
	if (count === undefined) {
		if (!isRecord(frames)) {
			return fail(`${path} is not a frame: give { plot, chart, readout, stats, caption }`);
		}
		const unknown = Object.keys(frames).find((key) => !FRAME_KEYS.has(key));
		return unknown
			? fail(`${path} has "${unknown}": a frame holds plot, chart, readout, stats or caption`)
			: [[path, frames]];
	}
	if (!Array.isArray(frames) || frames.length !== count) {
		const items = Array.isArray(frames) ? `${frames.length} items` : "no list";
		return fail(
			`${path} has ${items}, but control "${controls[level]?.id}" has ${count} values: give one item per value`,
		);
	}
	return frames.flatMap((frame, i) => flatten(frame, controls, counts, `${path}[${i}]`));
}

/** The first part of an option that JSON would not carry to the browser, as `path`. */
function notJson(value: unknown, path: string): string | undefined {
	if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
		return path;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? undefined : path;
	}
	if (value === null || typeof value !== "object") {
		return undefined;
	}
	if (
		!Array.isArray(value) &&
		("props" in value || Object.getPrototypeOf(value) !== Object.prototype)
	) {
		return path;
	}
	for (const [key, item] of Object.entries(value)) {
		const found = notJson(item, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`);
		if (found) {
			return found;
		}
	}
	return undefined;
}

/** `patch` merged into `base`: objects key by key, anything else (arrays included) replaced. */
function merge(base: unknown, patch: unknown): unknown {
	if (!isRecord(base) || !isRecord(patch)) {
		return patch === undefined ? base : patch;
	}
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		merged[key] = merge(base[key], value);
	}
	return merged;
}

/** Text or JSX as HTML, rendered now: the island shows it as it is. */
const toHtml = (content: ComponentChildren) => renderToString(h(Fragment, null, content));

/** One frame with the base under it, as the island shows it; `kind` is the figure every frame draws. */
function shownFrame(
	base: ExploreFrame,
	[path, frame]: [string, ExploreFrame],
	kind: "plot" | "chart" | undefined,
) {
	const shown: Shown = {};
	const option = kind && merge(base[kind], frame[kind]);
	if (option !== undefined) {
		const bad = notJson(option, `${path}.${kind}`);
		if (bad) {
			fail(
				`${bad} is not JSON: write formats and labels as JSON ({ digits: 1, unit: "kHz" }), or use a client component`,
			);
		}
		shown.figure = JSON.parse(JSON.stringify(option));
	}
	const readout = frame.readout ?? base.readout;
	const caption = frame.caption ?? base.caption;
	const stats = { ...base.stats, ...frame.stats };
	if (readout != null) {
		shown.readout = toHtml(readout);
	}
	if (Object.keys(stats).length) {
		shown.stats = Object.fromEntries(
			Object.entries(stats).map(([term, value]) => [term, toHtml(value)]),
		);
	}
	if (caption != null) {
		shown.caption = toHtml(caption);
	}
	return shown;
}

/** The figure the frames draw, the same in every one. */
function figureKind(
	base: ExploreFrame,
	frames: [string, ExploreFrame][],
): "plot" | "chart" | undefined {
	const kinds = new Set(
		[base, ...frames.map(([, frame]) => frame)].flatMap((f) => [
			...(f.plot ? ["plot" as const] : []),
			...(f.chart ? ["chart" as const] : []),
		]),
	);
	return kinds.size > 1
		? fail("draws a plot in some frames and a chart in others: choose one")
		: [...kinds][0];
}

/** A text or stats key some frame has and another lacks becomes empty there, so the live region stays in place. */
function fillGaps(frames: Shown[]) {
	const terms = [...new Set(frames.flatMap((f) => Object.keys(f.stats ?? {})))];
	for (const frame of frames) {
		for (const key of ["readout", "caption"] as const) {
			if (frame[key] === undefined && frames.some((f) => f[key] !== undefined)) {
				frame[key] = "";
			}
		}
		if (terms.length) {
			frame.stats = Object.fromEntries(terms.map((term) => [term, frame.stats?.[term] ?? ""]));
		}
	}
}

/** Smallest and largest of many numbers, without spreading them into one call. */
function extent(values: Iterable<number>): [number, number] {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
	}
	return [lo, hi];
}

const isPoint = (p: unknown): p is [number, number] =>
	Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number";

/**
 * Line points rounded to 1/10000 of the x and y ranges every frame's lines span, a tenth of a pixel on a 1000-pixel plot: computed
 * values carry 17 digits, which would be most of the page's size. Stems and bars print their values, so they are kept as given.
 */
function roundLines(frames: Shown[]) {
	const lines = frames.flatMap((f) =>
		((f.figure as PlotOption | undefined)?.series ?? []).filter(
			(s) => (s.type ?? "line") === "line",
		),
	);
	const points = lines.flatMap((s) => s.data.filter(isPoint));
	const places = (k: 0 | 1) => {
		const [lo, hi] = extent(points.map((p) => p[k]));
		return hi > lo ? Math.max(0, Math.ceil(-Math.log10((hi - lo) / 1e4))) : undefined;
	};
	const [dx, dy] = [places(0), places(1)];
	const round = (v: number, d: number | undefined) => (d === undefined ? v : +v.toFixed(d));
	for (const s of lines) {
		s.data = s.data.map((p) => (isPoint(p) ? [round(p[0], dx), round(p[1], dy)] : p));
	}
}

/** The first frame whole, each frame's patch against it (each distinct patch once), and which patch each frame takes. */
function compact(frames: Shown[]): Pick<ExploreData, "first" | "patches" | "at"> {
	const first = frames[0] as Json;
	const patches: Json[] = [];
	const seen = new Map<string, number>();
	const at = frames.map((frame) => {
		const patch = diff(first, frame as Json) ?? {};
		const key = JSON.stringify(patch);
		const known = seen.get(key);
		if (known !== undefined) {
			return known;
		}
		seen.set(key, patches.length);
		return patches.push(patch) - 1;
	});
	return { first, patches, at };
}

/**
 * Prepares the frames in pack (validated, merged with the base, readouts rendered to HTML, lines rounded, each frame a patch
 * against the first) and renders the island for the figure they draw, which hydrates in the browser.
 */
export function Explore({ controls, frames, base = {}, label, class: extra, id }: ExploreProps) {
	if (!controls.length) {
		fail("needs controls: a range, a choice or a toggle");
	}
	const made = controls.map(control);
	const counts = made.map((m) => valueCount(m.control));
	const listed = flatten(frames, controls, counts);
	const kind = figureKind(base, listed);
	if (kind && !label) {
		fail(`needs a label: the accessible name of its ${kind}`);
	}
	const shown = listed.map((frame) => shownFrame(base, frame, kind));
	fillGaps(shown);
	if (kind === "plot") {
		roundLines(shown);
	}
	const data: ExploreData = {
		controls: made.map((m) => m.control),
		start: made.map((m) => m.start),
		...compact(shown),
		label: label ?? "",
		...(extra ? { class: extra } : {}),
		...(id ? { id } : {}),
	};
	const Island = kind === "plot" ? ExplorePlot : kind === "chart" ? ExploreChart : ExploreText;
	return <Island {...data} />;
}
