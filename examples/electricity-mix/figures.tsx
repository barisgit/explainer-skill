"use client";
/* The overview's first two figures and the parts every figure shares: the world mix, and what changed in a place since 2000.
   Each redraws from model.ts as its controls change; a section whose heading states what its controls show renders it too.
   coal.tsx ranks the countries, place.tsx draws the drill-down view. */
import { Chart } from "kit";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
	cell,
	dP,
	dT,
	EPS,
	fmtT,
	itemised,
	list,
	num,
	type Part,
	PLACES,
	type Place,
	partialYears,
	pc,
	pctOf,
	placeOf,
	REST,
	raw,
	restTwh,
	SOURCES,
	type Source,
	share,
	total,
	twh,
	type Unit,
	WORLD,
	Y0,
	Y1,
	YEARS,
} from "./model.ts";

/** What an axis tooltip formatter receives for each series. */
interface AxisParam {
	axisValue: number;
	value: [number, number | null];
	marker: string;
	seriesName: string;
}

const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);

/** A segmented radio group: the kit's .seg look over native radios. */
export function Seg<T extends string>(props: {
	name: string;
	label: string;
	value: T;
	options: [T, string][];
	onPick: (value: T) => void;
}) {
	return (
		<div class="seg" role="radiogroup" aria-label={props.label}>
			{props.options.map(([value, text]) => (
				<label key={value}>
					<input
						type="radio"
						name={props.name}
						value={value}
						checked={value === props.value}
						onChange={() => props.onPick(value)}
					/>
					<span>{text}</span>
				</label>
			))}
		</div>
	);
}

const MODES: [Unit, string][] = [
	["twh", "Amount (TWh)"],
	["share", "Share (%)"],
];

/* ---- 1. Stacked mix: one option draws the world, and any place in the drill-down view. ---- */

function mixOption(place: Place, mode: Unit): ChartOption {
	const pct = mode === "share";
	const bands = [
		...SOURCES.map((s) => ({ part: s, at: (y: number) => twh(place, s, y) })),
		...(partialYears(place).length ? [{ part: REST, at: (y: number) => restTwh(place, y) }] : []),
	];
	const value = (v: number | null, y: number) => (pct ? pctOf(v, total(place, y)) : v);
	const line = (p: AxisParam) => {
		const v = p.value[1] ?? 0;
		return `${p.marker} ${p.seriesName}: <b>${pct ? pc(v, v >= 10 ? 0 : 1) : `${fmtT(v)} TWh`}</b>`;
	};
	return {
		grid: { top: 64, left: 8, right: 24, bottom: 8 },
		legend: { top: 8, left: 8, right: 8 },
		// Below 640 px the legend wraps, so the plot starts lower. As a media query, pack's drawings follow it too.
		media: [{ query: { maxWidth: 639 }, option: { grid: { top: 112 } } }],
		tooltip: {
			trigger: "axis",
			formatter: (params: AxisParam[]) => {
				const year = params[0]?.axisValue ?? Y0;
				const rows = params.toReversed().filter((p) => p.value[1]);
				return `<b>${year}</b><br>${rows.map(line).join("<br>")}<br>Total: <b>${cell(total(place, year), fmtT)} TWh</b>`;
			},
		},
		xAxis: { type: "value", min: Y0, max: Y1, interval: 4, axisLabel: { formatter: String } },
		yAxis: {
			type: "value",
			max: pct ? 100 : null,
			axisLabel: { formatter: pct ? "{value}%" : (v: number) => num.format(v) },
		},
		series: bands.map(({ part, at }) => ({
			id: part.id,
			name: part.name,
			type: "line",
			stack: "mix",
			showSymbol: false,
			color: part.color,
			lineStyle: { width: 0.5 },
			areaStyle: { opacity: part === REST ? 1 : 0.88 },
			emphasis: { focus: "series" },
			data: YEARS.map((y) => [y, total(place, y) === null ? null : value(at(y), y)]),
		})),
	};
}

/** The stacked mix of one place, with its Amount/Share switch. `name` names the switch's radio group. */
export function MixFigure(props: {
	place: Place;
	name: string;
	id: string;
	label: string;
	caption: ComponentChildren;
}) {
	const [mode, setMode] = useState<Unit>("twh");
	const option = useMemo(() => mixOption(props.place, mode), [props.place, mode]);
	return (
		<figure class="fig">
			<div class="controls">
				<Seg
					name={props.name}
					label="What the chart measures"
					value={mode}
					options={MODES}
					onPick={setMode}
				/>
			</div>
			<Chart id={props.id} height="clamp(22rem, 40vw, 24rem)" label={props.label} option={option} />
			<figcaption>{props.caption}</figcaption>
		</figure>
	);
}

/** The first figure: world generation by source since 2000. */
export function WorldMix() {
	return (
		<MixFigure
			place={WORLD}
			name="mode"
			id="world"
			label={`Stacked areas of world electricity generation by source, ${Y0} to ${Y1}`}
			caption={
				<>
					World electricity generation by source. Click a legend entry to hide a source (hide coal
					to read the small ones), or hover for the year's exact values.
					<span class="src">
						Source: Our World in Data energy dataset, built on Ember and Energy Institute data;
						licences in the method notes below.
					</span>
				</>
			}
		/>
	);
}

/* ---- 2. What changed, by source, for any place. ---- */

/** One source's row in the change table and chart; a value is null where the release leaves it blank. */
interface Move {
	part: Part;
	a: number | null;
	b: number | null;
	dT: number | null;
	sa: number | null;
	sb: number | null;
}

/** Each source's change between Y0 and `end`, then the generation no source accounts for when either year has some. */
function moves(place: Place, end: number): Move[] {
	const [t0, t1] = [total(place, Y0), total(place, end)];
	const source = (s: Source): Move => ({
		part: s,
		a: raw(place, s, Y0),
		b: raw(place, s, end),
		dT: diff(twh(place, s, Y0), twh(place, s, end)),
		sa: share(place, s, Y0),
		sb: share(place, s, end),
	});
	const [r0, r1] = [restTwh(place, Y0), restTwh(place, end)];
	const rest: Move = {
		part: REST,
		a: r0,
		b: r1,
		dT: diff(r0, r1),
		sa: pctOf(r0, t0),
		sb: pctOf(r1, t1),
	};
	const partial = !(itemised(place, Y0) && itemised(place, end));
	return [...SOURCES.map(source), ...(partial ? [rest] : [])];
}

const moveOf = (m: Move, unit: Unit) => (unit === "twh" ? m.dT : diff(m.sa, m.sb));

/** The axes of a horizontal bar chart of changes, one category per row, the values as labels on the bars. */
export const BAR_AXES = {
	grid: { top: 16, left: 8, right: 8, bottom: 8 },
	xAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
	yAxis: {
		type: "category",
		inverse: true,
		axisLine: { onZero: false },
		axisLabel: { formatter: "{value}" },
	},
};

const NO_BARS: ChartOption = {
	...BAR_AXES,
	tooltip: { show: false },
	yAxis: { ...BAR_AXES.yAxis, data: [] },
	series: [],
};

/** Bars for the known changes, largest first, then the rest of the total, then the sources with no value, labelled so. */
function movesOption(rows: Move[], unit: Unit): ChartOption {
	const fmt = unit === "twh" ? dT : dP;
	const known = rows.flatMap((m) => {
		const v = moveOf(m, unit);
		return v === null || !Number.isFinite(v) ? [] : [{ m, v }];
	});
	const sources = known.filter(({ m }) => m.part !== REST).sort((x, y) => y.v - x.v);
	if (sources.length === 0) {
		return NO_BARS;
	}
	const shown = [...sources, ...known.filter(({ m }) => m.part === REST)];
	const unknown = rows.filter((m) => m.part !== REST && moveOf(m, unit) === null);
	const values = shown.map(({ v }) => v);
	const [lo, hi] = [Math.min(0, ...values), Math.max(0, ...values)];
	const pad = (hi - lo) * 0.3 || 1;
	return {
		...BAR_AXES,
		tooltip: { show: false },
		xAxis: { ...BAR_AXES.xAxis, min: lo - pad, max: hi + pad },
		yAxis: {
			...BAR_AXES.yAxis,
			data: [...shown.map(({ m }) => m.part.name), ...unknown.map((m) => m.part.name)],
		},
		series: [
			{
				id: "change",
				type: "bar",
				barWidth: "58%",
				markLine: {
					silent: true,
					symbol: "none",
					label: { show: false },
					lineStyle: { color: "var(--muted)", type: "solid" },
					data: [{ xAxis: 0 }],
				},
				data: [
					...shown.map(({ m, v }) => ({
						value: v,
						itemStyle: { color: m.part.color },
						label: { show: true, position: v < 0 ? "left" : "right", formatter: () => fmt(v) },
					})),
					...unknown.map(() => ({
						value: 0,
						itemStyle: { color: "transparent" },
						label: { show: true, position: "right", formatter: "no value" },
					})),
				],
			},
		],
	};
}

/** The section heading: the source that grew most and the one that fell most, in the chosen unit. */
function changeTitle(place: Place, end: number, unit: Unit, rows: Move[]) {
	const [fmt, suffix, eps] = unit === "twh" ? [dT, " TWh", EPS.twh] : [dP, " pts", EPS.share];
	const known = rows
		.filter((m) => m.part !== REST)
		.flatMap((m) => {
			const v = moveOf(m, unit);
			return v === null ? [] : [{ name: m.part.name.toLowerCase(), v }];
		})
		.sort((x, y) => y.v - x.v);
	const [top, bottom] = [known[0], known.at(-1)];
	if (!(top && bottom)) {
		const none = total(place, Y0) ? end : Y0;
		return `${place.name}, ${Y0} to ${end}: shares are undefined because it generated no electricity in ${none}`;
	}
	// Only sources with a known change compete; zero is not growth.
	const grew = top.v > eps ? `${top.name} grew most (${fmt(top.v)}${suffix})` : "no source grew";
	const fell =
		bottom.v < -eps ? `${bottom.name} fell most (${fmt(bottom.v)}${suffix})` : "none fell";
	return `${place.name}, ${Y0} to ${end}: ${grew}, ${fell}`;
}

/** The sentence under the chart: which sources shrank, which had no value, and where the release does not itemise. */
function changeNote(place: Place, end: number, unit: Unit, rows: Move[]) {
	const [t0, t1] = [total(place, Y0), total(place, end)];
	const sources = rows.filter((m) => m.part !== REST);
	const less = sources.filter((m) => m.dT !== null && m.dT < -EPS.twh).map((m) => m.part.name);
	const smaller = sources
		.filter((m) => (diff(m.sa, m.sb) ?? 0) < -EPS.share)
		.map((m) => m.part.name);
	const unknown = sources
		.filter((m) => moveOf(m, unit) === null)
		.map((m) => m.part.name.toLowerCase());
	const gap = [Y0, end].filter((y) => !itemised(place, y));
	const notes = [
		unit === "share" && !(t0 && t1)
			? `Shares are undefined: ${place.name} generated no electricity in ${t0 ? end : Y0}.`
			: `Generated less: ${list(less)}. Smaller share: ${list(smaller)}.`,
	];
	if (unknown.length && t0 && t1) {
		notes.push(
			`No value for ${list(unknown)} in ${gap.join(" or ")}, so ${unknown.length > 1 ? "their changes are" : "its change is"} not shown.`,
		);
	}
	if (gap.length) {
		notes.push(
			`In ${gap.join(" and ")} the release does not split all generation by source; the rest is "Not itemised".`,
		);
	}
	return { text: notes.join(" "), less: less.length, smaller: smaller.length };
}

/** Everything the change section shows for one place, end year and unit; `rows` is empty when either year has no data. */
function changeView(place: Place, end: number, unit: Unit) {
	const [t0, t1] = [total(place, Y0), total(place, end)];
	if (t0 === null || t1 === null) {
		return {
			title: `${place.name} has no data for ${t0 === null ? Y0 : end}`,
			total: null,
			less: "–",
			smaller: "–",
			note: "Pick a different end year or place.",
			rows: [],
			option: NO_BARS,
		};
	}
	const rows = moves(place, end);
	const counted = rows.filter((m) => m.part !== REST && m.dT !== null).length;
	const note = changeNote(place, end, unit, rows);
	return {
		title: changeTitle(place, end, unit, rows),
		total: [t1, t0] as const,
		less: `${note.less} of ${counted}`,
		smaller: t0 && t1 ? `${note.smaller} of ${counted}` : "–",
		note: note.text,
		rows,
		option: movesOption(rows, unit),
	};
}

/** The place picker: regions, then countries. */
function PlaceSelect(props: { value: string; onPick: (slug: string) => void }) {
	return (
		<select id="place" value={props.value} onChange={(e) => props.onPick(e.currentTarget.value)}>
			{[true, false].map((region) => (
				<optgroup key={String(region)} label={region ? "Regions" : "Countries"}>
					{PLACES.filter((p) => p.region === region).map((p) => (
						<option key={p.slug} value={p.slug}>
							{p.name}
						</option>
					))}
				</optgroup>
			))}
		</select>
	);
}

/** The change table: TWh and share in both years, and their change; – where the release leaves a value blank. */
function ChangeTable(props: { rows: Move[]; end: number }) {
	const heads = [
		`${Y0}, TWh`,
		`${props.end}, TWh`,
		"Change, TWh",
		`${Y0}, share`,
		`${props.end}, share`,
		"Change, pts",
	];
	return (
		<table class="compare table" id="change-table">
			{props.rows.length > 0 && (
				<thead>
					<tr>
						<th>Source</th>
						{heads.map((h) => (
							<th class="num" key={h}>
								{h}
							</th>
						))}
					</tr>
				</thead>
			)}
			<tbody>
				{props.rows.map((m) => (
					<tr key={m.part.id}>
						<th scope="row">{m.part.name}</th>
						<td class="num">{cell(m.a, fmtT)}</td>
						<td class="num">{cell(m.b, fmtT)}</td>
						<td class="num">{cell(m.dT, dT)}</td>
						<td class="num">{pc(m.sa, 1)}</td>
						<td class="num">{pc(m.sb, 1)}</td>
						<td class="num">{cell(diff(m.sa, m.sb), dP)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * Section 2: pick a place and an end year; the heading, stats, bars and table say what changed since 2000. The intro under
 * the heading is the children from the page.
 */
export function ChangeExplorer({ children }: { children?: ComponentChildren }) {
	const [key, setKey] = useState(WORLD.slug);
	const [end, setEnd] = useState(Y1);
	const [unit, setUnit] = useState<Unit>("twh");
	const place = placeOf(key) ?? WORLD;
	const view = useMemo(() => changeView(place, end, unit), [place, end, unit]);
	return (
		<>
			<h2>{view.title}</h2>
			{children}
			<figure class="fig">
				<div class="controls">
					<label class="field pick" for="place">
						<span>Place</span>
						<PlaceSelect value={key} onPick={setKey} />
					</label>
					<label class="field">
						<span>Compare {Y0} with</span>
						<input
							type="range"
							id="end"
							min={Y0 + 1}
							max={Y1}
							value={end}
							onInput={(e) => setEnd(Number(e.currentTarget.value))}
						/>
						<output id="end-out" for="end">
							{end}
						</output>
					</label>
				</div>
				<div class="controls">
					<Seg
						name="unit"
						label="Unit of change"
						value={unit}
						options={[
							["twh", "Change in TWh"],
							["share", "Change in share (points)"],
						]}
						onPick={setUnit}
					/>
				</div>
				<dl class="stats" aria-live="polite">
					<div class="stat">
						<dt>Total generation</dt>
						<dd>
							{view.total ? (
								<>
									{fmtT(view.total[0])} <small>TWh, was {fmtT(view.total[1])}</small>
								</>
							) : (
								"No data"
							)}
						</dd>
					</div>
					<div class="stat">
						<dt>Sources that generated less</dt>
						<dd>{view.less}</dd>
					</div>
					<div class="stat">
						<dt>Sources with a smaller share</dt>
						<dd>{view.smaller}</dd>
					</div>
				</dl>
				<Chart
					id="moves"
					height="clamp(20rem, 52vw, 28rem)"
					label="Change in electricity generation by source for the chosen place"
					option={view.option}
				/>
				<p class="note" id="c-note">
					{view.note}
					{view.rows.length > 0 && (
						<>
							{" "}
							Every year for <a href={`#place/${place.slug}`}>{place.name}</a>
						</>
					)}
				</p>
			</figure>
			<details>
				<summary>Values for this place (TWh, rounded; – means not reported)</summary>
				<div class="scroll">
					<ChangeTable rows={view.rows} end={end} />
				</div>
			</details>
		</>
	);
}
