"use client";
/* Section 3: every country with data for both years, ranked by how far it moved away from coal (or toward it). The heading,
   stats, bars, caption and table follow the period, direction, measure and size cut-off; a bar opens the country's view. */
import { Chart } from "kit";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { BAR_AXES, Seg } from "./figures.tsx";
import { COAL, COUNTRIES, dP, dT, EPS, fmtT, num, total, twh, type Unit, Y0, Y1 } from "./model.ts";

/** One country's coal figures for the period: share (a, b) and output (ta, tb) at the start and end, and their changes. */
interface Row {
	name: string;
	slug: string;
	a: number;
	b: number;
	ta: number;
	tb: number;
	dP: number;
	dT: number;
}

/** One row per country with a known coal figure and positive generation in both years, and at least `minTwh` in the end year. */
function coalRows(from: number, to: number, minTwh: number): Row[] {
	return COUNTRIES.flatMap((p) => {
		const [t0, t1] = [total(p, from), total(p, to)];
		const [ta, tb] = [twh(p, COAL, from), twh(p, COAL, to)];
		if (!(t0 && t1) || t1 < minTwh || ta === null || tb === null) {
			return [];
		}
		const [a, b] = [(100 * ta) / t0, (100 * tb) / t1];
		return [{ name: p.name, slug: p.slug, a, b, ta, tb, dP: b - a, dT: tb - ta }];
	});
}

interface Settings {
	from: number;
	to: number;
	away: boolean;
	metric: Unit;
	minTwh: number;
}

/** The bars: the size of each move, so the biggest is the longest and grows from the left whatever the direction. */
function rankOption(shown: Row[], metric: Unit): ChartOption {
	const [key, fmt, unit] =
		metric === "share" ? (["dP", dP, " pts"] as const) : (["dT", dT, " TWh"] as const);
	const longest = Math.max(...shown.map((r) => Math.abs(r[key])), 1e-9);
	const tip = (r: Row) =>
		`<b>${r.name}</b><br>Coal's share: ${r.a.toFixed(1)}% → ${r.b.toFixed(1)}%<br>Coal output: ${fmtT(r.ta)} → ${fmtT(r.tb)} TWh<br>Click to open`;
	return {
		...BAR_AXES,
		tooltip: { trigger: "item", formatter: (p: { data: { tip: string } }) => p.data.tip },
		xAxis: { ...BAR_AXES.xAxis, min: 0, max: longest * 1.25 },
		yAxis: { ...BAR_AXES.yAxis, data: shown.map((r) => r.name) },
		series: [
			{
				id: "rank",
				type: "bar",
				barWidth: "62%",
				cursor: "pointer",
				data: shown.map((r) => ({
					value: Math.abs(r[key]),
					slug: r.slug,
					tip: tip(r),
					itemStyle: { color: COAL.color },
					label: { show: true, position: "right", formatter: () => `${fmt(r[key])}${unit}` },
				})),
			},
		],
	};
}

/** The heading: the country that moved most, in the chosen measure. */
function rankTitle(top: Row | undefined, s: Settings) {
	const verb = s.away ? "cut" : "raised";
	if (!top) {
		return `No country with these settings ${verb} its coal ${s.metric === "share" ? "share" : "output"}`;
	}
	return s.metric === "share"
		? `${top.name} ${verb} coal's share of its electricity the most, from ${top.a.toFixed(0)}% in ${s.from} to ${top.b.toFixed(0)}% in ${s.to}`
		: `${top.name} ${verb} its coal output the most, by ${fmtT(Math.abs(top.dT))} TWh between ${s.from} and ${s.to}`;
}

/** Everything the section shows for one set of settings. */
function rankView(s: Settings) {
	const [key, eps] =
		s.metric === "share" ? (["dP", EPS.share] as const) : (["dT", EPS.twh] as const);
	const order = s.away ? 1 : -1; // 1 sorts the biggest fall first; -1 the biggest rise first
	const rows = coalRows(s.from, s.to, s.minTwh).sort((x, y) => (x[key] - y[key]) * order);
	const moved = rows.filter((r) => r[key] * order < -eps);
	const shown = moved.slice(0, 15);
	const noun = s.metric === "share" ? "share" : "output";
	const fell = rows.filter((r) => r[key] < -eps).length;
	const rose = rows.filter((r) => r[key] > eps).length;
	const cut = s.minTwh ? `, or under ${num.format(s.minTwh)} TWh generated in ${s.to}` : "";
	return {
		rows,
		noun,
		fell,
		rose,
		title: rankTitle(shown[0], s),
		caption: `${shown.length} of ${moved.length} countries that ${s.away ? "cut" : "raised"} coal ${noun} shown, ${s.from} to ${s.to}. ${rows.length - fell - rose} of the ${rows.length} compared had no change. ${COUNTRIES.length - rows.length} of ${COUNTRIES.length} are left out: no data for ${s.from} or ${s.to}${cut}. Click a bar to open the country.`,
		option: rankOption(shown, s.metric),
	};
}

/** A bar's country, from the slug its data item carries. */
const openPlace = (chart: ECharts) =>
	chart.on("click", (p) => {
		const slug = (p.data as { slug?: string } | undefined)?.slug;
		if (slug) {
			location.hash = `#place/${slug}`;
		}
	});

const PRESETS = [
	[2000, 2024],
	[2010, 2024],
	[2019, 2024],
] as const;

/** A year slider with its readout. */
function Year(props: {
	id: string;
	label: string;
	min: number;
	max: number;
	value: number;
	onYear: (y: number) => void;
}) {
	return (
		<label class="field">
			<span>{props.label}</span>
			<input
				type="range"
				id={props.id}
				min={props.min}
				max={props.max}
				value={props.value}
				onInput={(e) => props.onYear(Number(e.currentTarget.value))}
			/>
			<output id={`${props.id}-out`} for={props.id}>
				{props.value}
			</output>
		</label>
	);
}

/**
 * The ranking's controls: the period (From stays before To by pushing the slider not touched), direction, measure, size.
 * `update` derives each change from the latest settings, so events that arrive before a render (a restore) all count.
 */
function RankControls(props: {
	s: Settings;
	update: (change: (s: Settings) => Partial<Settings>) => void;
}) {
	const { s, update } = props;
	return (
		<>
			<div class="controls">
				<Year
					id="from"
					label="From"
					min={Y0}
					max={Y1 - 1}
					value={s.from}
					onYear={(from) => update((now) => ({ from, to: Math.max(now.to, from + 1) }))}
				/>
				<Year
					id="to"
					label="To"
					min={Y0 + 1}
					max={Y1}
					value={s.to}
					onYear={(to) => update((now) => ({ to, from: Math.min(now.from, to - 1) }))}
				/>
				<fieldset class="seg presets" aria-label="Period presets">
					{PRESETS.map(([from, to]) => (
						<button
							key={from}
							class="btn"
							type="button"
							onClick={() => update(() => ({ from, to }))}
						>
							{from}–{to}
						</button>
					))}
				</fieldset>
			</div>
			<div class="controls">
				<Seg
					name="dir"
					label="Direction"
					value={s.away ? "away" : "toward"}
					options={[
						["away", "Away from coal"],
						["toward", "Toward coal"],
					]}
					onPick={(dir) => update(() => ({ away: dir === "away" }))}
				/>
				<Seg
					name="metric"
					label="Measure"
					value={s.metric}
					options={[
						["share", "Share of electricity"],
						["twh", "Coal output (TWh)"],
					]}
					onPick={(metric) => update(() => ({ metric }))}
				/>
				<div class="field">
					<span>Generating at least</span>
					<Seg
						name="size"
						label="Smallest place included, by electricity generated in the end year"
						value={String(s.minTwh)}
						options={[
							["0", "Any"],
							["10", "10 TWh"],
							["100", "100 TWh"],
							["1000", "1,000 TWh"],
						]}
						onPick={(size) => update(() => ({ minTwh: Number(size) }))}
					/>
				</div>
			</div>
		</>
	);
}

/** Every country in the ranking, with a search that hides the rest. */
function RankTable(props: { rows: Row[] }) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	return (
		<details>
			<summary>Every country in this ranking</summary>
			<div class="controls">
				<label class="field">
					<span>Find a country</span>
					<input
						type="search"
						id="find"
						autocomplete="off"
						value={query}
						onInput={(e) => setQuery(e.currentTarget.value)}
					/>
				</label>
			</div>
			<div class="scroll table-box">
				<table class="compare table">
					<thead>
						<tr>
							<th>Country</th>
							<th class="num">Coal's share</th>
							<th class="num">Change</th>
							<th class="num">Coal output, TWh</th>
						</tr>
					</thead>
					<tbody>
						{props.rows.map((r) => (
							<tr key={r.slug} hidden={q !== "" && !r.name.toLowerCase().includes(q)}>
								<th scope="row">
									<a href={`#place/${r.slug}`}>{r.name}</a>
								</th>
								<td class="num">
									{r.a.toFixed(0)}% → {r.b.toFixed(0)}%
								</td>
								<td class="num">{dP(r.dP)} pts</td>
								<td class="num">
									{fmtT(r.ta)} → {fmtT(r.tb)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}

/** Section 3: who left coal, and who turned to it; the intro under the heading is the children from the page. */
export function CoalRanking({ children }: { children?: ComponentChildren }) {
	const [s, set] = useState<Settings>({
		from: Y0,
		to: Y1,
		away: true,
		metric: "share",
		minTwh: 10,
	});
	const view = useMemo(() => rankView(s), [s]);
	return (
		<>
			<h2>{view.title}</h2>
			{children}
			<figure class="fig">
				<RankControls s={s} update={(change) => set((now) => ({ ...now, ...change(now) }))} />
				<dl class="stats" aria-live="polite">
					<div class="stat">
						<dt>Countries compared</dt>
						<dd>{view.rows.length}</dd>
					</div>
					<div class="stat">
						<dt>Coal {view.noun} fell in</dt>
						<dd>
							{view.fell} <small>countries</small>
						</dd>
					</div>
					<div class="stat">
						<dt>Coal {view.noun} rose in</dt>
						<dd>
							{view.rose} <small>countries</small>
						</dd>
					</div>
				</dl>
				<Chart
					id="rank"
					height="clamp(20rem, 52vw, 28rem)"
					label="Countries ranked by change in coal use over the chosen period"
					option={view.option}
					setup={openPlace}
				/>
				<figcaption>{view.caption}</figcaption>
			</figure>
			<RankTable rows={view.rows} />
		</>
	);
}
