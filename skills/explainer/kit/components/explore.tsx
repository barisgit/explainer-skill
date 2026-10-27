/* Explore: a slider, choice or toggles switching a plot or chart and readout through your function.
   <Explore label="Envelope against g(t)" controls={[{ id: "m", label: "Modulation index m", range: [0, 1.5, 0.05], value: 0.5 }]}
     frame={envelope} />
     controls  one or more, each with a label and an id (its value is kept across reloads):
       range: [min, max, step]   a slider; value is where it starts (default min), format writes its readout ({ digits: 2 }, { unit: "%" })
       choice: ["LC", "SC"]      one of the texts, as a segmented switch ({ lc: "With carrier", ... } gives frame "lc");
                                 value is the one it starts on (default the first)
       toggle: true              a switch, off then on; value: true starts it on
     frame     (...values) => what the figure shows, given the controls' values in order (a number, a text, true or false):
       plot     a Plot option (kit Plot), or chart, a Chart option (kit Chart)
       readout  text or JSX in a live line over the figure; stats { "Carrier": "67%" }, text or JSX, are figures in a row
       caption  text or JSX under the figure
     base      what every frame shares (axes, colours, the caption); a frame's keys merge over it
     label     the figure's accessible name
     class     more classes on the plot or chart, e.g. "tall"
     height    the plot or chart's height, as in kit Chart: "clamp(16rem, 34vw, 21rem)"
   Where frame runs: exported from a module whose first line is "use client", it ships and runs in the browser on each change
   (base is then JSON); use that for sliders over model curves. Otherwise pack calls it for every combination and the page
   carries the results as JSON (formats as JSON too), which suits a choice, toggles or a few steps; above 100 KB pack fails.
   Either way pack calls it for every combination, so a value it cannot draw fails the pack, not the reader's page, and the
   starting frame is in the page as SVG when pack can draw its Plot or Chart (see kit Chart). */
import { type ComponentChildren, Fragment, h } from "preact";
import { renderToString } from "preact-render-to-string";
import { isClientExport, notJson } from "../islands/props.ts";
import { Explore as ExploreChart } from "./parts/explore-chart.tsx";
import { Explore as ExplorePlot } from "./parts/explore-plot.tsx";
import { Explore as ExploreText } from "./parts/explore-text.tsx";
import {
	type ExploreControl,
	type ExploreData,
	type ExploreFrame,
	type ExploreValue,
	type FrameFunction,
	valueAt,
	valueCount,
	withBase,
} from "./parts/explore-view.tsx";
import { numberText } from "./parts/format.ts";
import { diff, isPoint, type Json } from "./parts/frames.ts";

export type { ExploreFrame, ExploreValue };

/** One control as the page writes it. */
export type ExploreControlProps = { id: string; label: string } & (
	| { range: readonly [number, number, number]; value?: number; format?: NumberFormat }
	| { choice: readonly string[] | Readonly<Record<string, string>>; value?: string }
	| { toggle: true; value?: boolean }
);

export interface ExploreProps {
	controls: readonly ExploreControlProps[];
	/** The frame for the controls' values; `never[]` lets a function with narrower parameters ((kind: Kind, m: number)) through. */
	frame: (...values: never[]) => ExploreFrame;
	base?: ExploreFrame;
	label?: string;
	class?: string;
	height?: string;
	id?: string;
}

/** A precomputed frame as the island gets it (explore-view.tsx): the figure's option as JSON, and HTML for the rest. */
interface Shown {
	plot?: Json;
	chart?: Json;
	readout?: string;
	stats?: Record<string, string>;
	caption?: string;
}

const FRAME_KEYS = new Set(["plot", "chart", "readout", "stats", "caption"]);
/** The most precomputed frames may take in the page; past it, the browser computing them is the better trade. */
const PRECOMPUTED_LIMIT = 100_000;

const fail = (message: string): never => {
	throw new Error(`<Explore> ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Decimals a number is written with: 2 for 0.05, 7 for 1e-7 (JavaScript writes small and large numbers with an exponent). */
function decimals(n: number): number {
	const [digits = "", exponent = "0"] = String(n).split("e");
	return Math.max(0, (digits.split(".")[1] ?? "").length - Number(exponent));
}

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
		return {
			control: { id, label, ...shown },
			start: Math.min(Math.max(at, 0), texts.length - 1),
		};
	}
	if ("choice" in spec) {
		const [values, texts] = Array.isArray(spec.choice)
			? [[...spec.choice], [...spec.choice]]
			: [Object.keys(spec.choice), Object.values(spec.choice)];
		const start = spec.value === undefined ? 0 : values.indexOf(spec.value);
		if (values.length < 2 || start < 0) {
			return fail(`control "${id}": choice needs two or more values, and value one of them`);
		}
		return { control: { id, label, choice: texts, values }, start };
	}
	if (spec.toggle !== true) {
		return fail(`control "${id}" needs range, choice or toggle: true`);
	}
	return { control: { id, label, toggle: true }, start: spec.value ? 1 : 0 };
}

/** Every combination of the controls' value indices, the first control outermost: the order explore-view.tsx indexes frames in. */
const combinations = (controls: ExploreControl[]): number[][] =>
	controls.reduce<number[][]>(
		(combos, c) =>
			combos.flatMap((combo) => Array.from({ length: valueCount(c) }, (_, i) => [...combo, i])),
		[[]],
	);

/** frame's result for `values`, checked, with the call written as the author would (`frame(0.5)`) for messages. */
function called(frame: FrameFunction, values: ExploreValue[]): [string, ExploreFrame] {
	const call = `frame(${values.map((v) => JSON.stringify(v)).join(", ")})`;
	let result: unknown;
	try {
		result = frame(...values);
	} catch (e) {
		return fail(`${call} threw: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (!isRecord(result)) {
		return fail(`${call} returned no frame: return { plot, chart, readout, stats, caption }`);
	}
	const unknown = Object.keys(result).find((key) => !FRAME_KEYS.has(key));
	if (unknown) {
		fail(`${call} returned "${unknown}": a frame holds plot, chart, readout, stats or caption`);
	}
	if (result.plot && result.chart) {
		fail(`${call} returned a plot and a chart: an Explore draws one`);
	}
	return [call, result];
}

/** Text or JSX as HTML, rendered now: the island shows it as it is. */
const toHtml = (content: ComponentChildren) => renderToString(h(Fragment, null, content));

/** A computed frame, with the base under it, as the island gets it; `kind` is the figure every frame draws. */
function shownFrame([call, frame]: [string, ExploreFrame], kind: "plot" | "chart" | undefined) {
	const shown: Shown = {};
	const option = kind && frame[kind];
	if (kind && option !== undefined) {
		const bad = notJson(option, `${call}.${kind}`)?.path;
		if (bad) {
			fail(
				`${bad} is not JSON: write formats and labels as JSON ({ digits: 1, unit: "kHz" }), or export frame from a "use client" module`,
			);
		}
		shown[kind] = JSON.parse(JSON.stringify(option));
	}
	if (frame.readout != null) {
		shown.readout = toHtml(frame.readout);
	}
	if (frame.stats && Object.keys(frame.stats).length) {
		shown.stats = Object.fromEntries(
			Object.entries(frame.stats).map(([term, value]) => [term, toHtml(value)]),
		);
	}
	if (frame.caption != null) {
		shown.caption = toHtml(frame.caption);
	}
	return shown;
}

/** The figure the frames draw, the same in every one. */
function figureKind(frames: ExploreFrame[]): "plot" | "chart" | undefined {
	const kinds = new Set(
		frames.flatMap((f) => [
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

/**
 * Line points rounded to 1/10000 of the x and y ranges every frame's lines span, a tenth of a pixel on a 1000-pixel plot: computed
 * values carry 17 digits, which would be most of the page's size. Stems and bars print their values, so they are kept as given.
 */
function roundLines(frames: Shown[]) {
	const lines = frames.flatMap((f) =>
		((f.plot as PlotOption | undefined)?.series ?? []).filter((s) => (s.type ?? "line") === "line"),
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
function compact(frames: Shown[]): { first: Json; patches: Json[]; at: number[] } {
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

/** The computed frames as the page carries them, failing when they would take more than PRECOMPUTED_LIMIT of it. */
function precomputed(frames: [string, ExploreFrame][], kind: "plot" | "chart" | undefined) {
	const shown = frames.map((frame) => shownFrame(frame, kind));
	fillGaps(shown);
	if (kind === "plot") {
		roundLines(shown);
	}
	const carried = compact(shown);
	const size = JSON.stringify(carried).length;
	if (size > PRECOMPUTED_LIMIT) {
		fail(
			`frames would take ${Math.round(size / 1024)} KB of the page: export frame from a module whose first line is "use client", and the browser computes each frame instead`,
		);
	}
	return carried;
}

/** The entries of `props` that have a value. */
const present = (props: Record<string, string | undefined>) =>
	Object.fromEntries(Object.entries(props).filter(([, value]) => value));

/**
 * Calls frame for every combination of the controls' values (in the browser, only for the starting ones), checks the results,
 * and renders the island for the figure they draw: with the frame function when a client module exports it, else with the
 * frames precomputed. Inside your own client component frame always runs in the browser.
 */
export function Explore({
	controls,
	frame,
	base = {},
	label,
	class: extra,
	height,
	id,
}: ExploreProps) {
	if (!controls.length || typeof frame !== "function") {
		fail("needs controls (a range, a choice or a toggle) and frame, a function of their values");
	}
	const made = controls.map(control);
	const shown = made.map((m) => m.control);
	const start = made.map((m) => m.start);
	const live = isClientExport(frame) || typeof document !== "undefined";
	const fn = frame as FrameFunction;
	const combos = typeof document === "undefined" ? combinations(shown) : [start];
	const frames = combos.map((combo) =>
		called(
			fn,
			combo.map((i, c) => valueAt(shown[c] as ExploreControl, i)),
		),
	);
	const merged = frames.map(([call, f]): [string, ExploreFrame] => [call, withBase(base, f)]);
	const kind = figureKind(merged.map(([, f]) => f));
	if (kind && !label) {
		fail(`needs a label: the accessible name of its ${kind}`);
	}
	const baseProblem = live ? notJson(base, "base")?.path : undefined;
	if (baseProblem) {
		fail(
			`${baseProblem} is not JSON: with frame computed in the browser, base reaches it as JSON; return the rest from frame`,
		);
	}
	const data: ExploreData = {
		controls: shown,
		start,
		label: label ?? "",
		...present({ class: extra, height, id }),
		...(live ? { frame: fn, base } : precomputed(merged, kind)),
	};
	const Island = kind === "plot" ? ExplorePlot : kind === "chart" ? ExploreChart : ExploreText;
	return <Island {...data} />;
}
