"use client";
/* The page's interactive parts: one component per group of things that change together. Everything else on the page is
   rendered once when it packs. */
import { Chart, Stepper } from "kit";
import { useMemo, useState } from "preact/hooks";
import {
	clock,
	DAY,
	type Day,
	FIXES,
	type Fix,
	fixList,
	fmt,
	mean,
	NONE,
	SECOND,
	STEADY,
	simulateWeek,
	WEEK,
	wait,
} from "./cafe.ts";

/** What an axis pointer label formatter receives. */
type Pointer = { value: number };
/** What a series label formatter receives for one of the fix marks. */
type Mark = { name: string; data: { wait: number } };

/* ---- 1. The curve: answer first, exact values in the stats, legend toggles in the chart. ---- */
const loads = Array.from({ length: 48 }, (_, i) => (50 + i) / 100);
const curveSeries = (
	[
		["One barista", NONE],
		["Uniform orders", STEADY],
		["Two baristas", SECOND],
	] as const
).map(([name, f]) => ({
	name,
	type: "line",
	smooth: true,
	showSymbol: false,
	data: loads.map((l) => [l * 100, +wait(f, l).toFixed(2)]),
}));

/** The curve with the reader's load marked on the one-barista line. */
function curveOption(load: number, one: number): ChartOption {
	const marker = {
		markLine: {
			silent: true,
			symbol: "none",
			lineStyle: { color: "var(--accent)", type: "dashed" },
			label: { show: false },
			data: [{ xAxis: load }],
		},
		markPoint: {
			symbol: "circle",
			symbolSize: 12,
			itemStyle: { color: "var(--accent)" },
			label: {
				position: "left",
				formatter: fmt(one),
				color: "var(--accent)",
				fontWeight: 700,
				textBorderColor: "var(--surface)",
				textBorderWidth: 3,
			},
			data: [{ coord: [load, one] }],
		},
	};
	return {
		grid: { top: 48, left: 8, right: 24, bottom: 8 }, // margins are padding: the theme keeps axis labels inside them
		legend: { top: 8, left: 8 },
		tooltip: { trigger: "axis", valueFormatter: fmt },
		xAxis: {
			type: "value",
			min: 50,
			max: 97,
			axisLabel: { formatter: "{value}% busy", hideOverlap: true },
		},
		yAxis: { type: "value", axisLabel: { formatter: "{value} min" } },
		series: curveSeries.map((s, i) => (i === 0 ? { ...s, ...marker } : s)),
	};
}

/** The first screen's figure: the load slider, the three waits it gives, and the curve they sit on. */
export function LoadCurve() {
	const [load, setLoad] = useState(90);
	const one = wait(NONE, load / 100);
	const option = useMemo(() => curveOption(load, one), [load, one]);
	return (
		<figure class="fig">
			<div class="controls">
				<label class="field">
					<span>Barista busy</span>
					<input
						type="range"
						id="load"
						min="50"
						max="97"
						value={load}
						onInput={(e) => setLoad(Number(e.currentTarget.value))}
					/>
					<output id="load-out" for="load">
						{load}%
					</output>
				</label>
			</div>
			<dl class="stats" aria-live="polite">
				<div class="stat">
					<dt>One barista</dt>
					<dd class="hot">{fmt(one)}</dd>
				</div>
				<div class="stat">
					<dt>Versus 50% busy</dt>
					<dd>{(one / wait(NONE, 0.5)).toFixed(1)}×</dd>
				</div>
				<div class="stat">
					<dt>Two baristas</dt>
					<dd>{fmt(wait(SECOND, load / 100))}</dd>
				</div>
			</dl>
			<Chart
				id="curve"
				label="Average wait against how busy the barista is, for one barista, uniform orders, and two baristas"
				option={option}
			/>
			<figcaption>
				Average wait before ordering, long-run formula, 2-minute average order, random arrivals.
				Click a legend entry to hide its line.
				<span class="src">
					Model: M/M/1, M/D/1 and M/M/2 queues. Illustrative, not measured in a real café.
				</span>
			</figcaption>
		</figure>
	);
}

/* ---- 2. The week: several playable cases, each step shows where we are and what has accumulated. ---- */
const dayLine = {
	id: "line",
	type: "line",
	step: "end",
	showSymbol: false,
	areaStyle: { opacity: 0.25 },
};

function dayOption(today: Day): ChartOption {
	return {
		grid: { top: 24, left: 8, right: 24, bottom: 56 },
		tooltip: {
			trigger: "axis",
			axisPointer: { label: { formatter: (p: Pointer) => clock(p.value) } },
		},
		xAxis: {
			type: "value",
			min: 0,
			max: DAY,
			interval: 60,
			axisLabel: { formatter: clock, hideOverlap: true },
		},
		yAxis: { type: "value", max: 50 },
		dataZoom: [
			{ type: "inside" },
			{ type: "slider", height: 20, bottom: 12, labelFormatter: clock },
		],
		series: [
			{
				...dayLine,
				data: today.line.map((n, m) => [m, n]),
				markPoint: {
					symbolSize: 44,
					data: [{ coord: [today.peakAt, today.peak], value: today.peak }],
				},
			},
		],
	};
}

const WEEK_LOADS = [0.8, 0.9, 0.95];

/** The week section: its heading, captions, stats and chart all follow the chosen load and the stepper's day. */
export function Week() {
	const [load, setLoad] = useState(0.9);
	const [step, setStep] = useState(WEEK.length); // the stepper opens on its last step (Friday)
	const days = useMemo(() => simulateWeek(load), [load]);
	const today = days[step - 1] ?? days[0];
	const option = useMemo(() => today && dayOption(today), [today]);
	const lines20 = (n: number) => days.slice(0, n).filter((x) => x.peak >= 20).length;
	return (
		<section>
			<h2>
				At {Math.round(load * 100)}% busy, {lines20(5)} of 5 days had a line of 20 people or more
			</h2>
			<p>
				Same café, same average load every day. Customers arrive at random, and random arrivals
				clump: some days the clumps land on top of each other and never clear.
			</p>
			{/* steps.js adds Back/Play/Next before the captions and fires stepchange; onStep redraws for the step's day. The
			    captions are a part of their own here, so the player sits between the load switch and the stats. */}
			<Stepper id="week" label="The simulated week, day by day" onStep={setStep}>
				<div class="controls">
					<div class="field">
						<span>Busy</span>
						<div class="seg" role="radiogroup" aria-label="How busy the barista is">
							{WEEK_LOADS.map((l) => (
								<label>
									<input
										type="radio"
										name="wload"
										value={l}
										checked={l === load}
										onChange={() => setLoad(l)}
									/>
									<span>{Math.round(l * 100)}%</span>
								</label>
							))}
						</div>
					</div>
				</div>
				{/* Each caption says where we are, what happened that day, and what has accumulated so far. */}
				<ol data-captions="">
					{days.map((d, i) => (
						<li>
							{WEEK[i]?.[0]}: the line peaked at {d.peak} people at {clock(d.peakAt)}. Days with 20
							or more so far: {lines20(i + 1)} of {i + 1}.
						</li>
					))}
				</ol>
				<dl class="stats">
					<div class="stat">
						<dt>Average wait</dt>
						<dd>{today && fmt(today.avg)}</dd>
					</div>
					<div class="stat">
						<dt>Longest line</dt>
						<dd>
							{today?.peak} <small>people</small>
						</dd>
					</div>
					<div class="stat">
						<dt>Week so far</dt>
						<dd>
							{fmt(mean(days.slice(0, step).flatMap((x) => x.waits)))} <small>average wait</small>
						</dd>
					</div>
				</dl>
				{option && (
					<Chart
						id="daychart"
						label="People waiting to order, minute by minute, for the selected day"
						option={option}
					/>
				)}
				<figcaption>
					People in line, minute by minute, 07:00 to 15:00. Scroll or drag the bar under the chart
					to zoom into a rush.
				</figcaption>
			</Stepper>
		</section>
	);
}

/* ---- 3. Fixes: animated switch between two views of one dataset, a reveal toggle, click to drill down. ---- */
const fixColor = (f: Fix) =>
	f.id === "none" ? "var(--bad)" : f.id === "second" ? "var(--ok)" : "var(--c1)";

function fixOption(view: string, hide: boolean): ChartOption {
	const list = fixList.filter((f) => !(hide && f.id === "none")).sort((a, b) => a.wait - b.wait);
	const label = { show: true, formatter: (p: Mark) => fmt(p.data.wait) };
	const item = (f: (typeof list)[number], value: number | number[]) => ({
		value,
		name: f.name,
		wait: f.wait,
		groupId: f.id,
		itemStyle: { color: fixColor(f) },
	});
	// set() merges, so each view states every axis key the other view changes.
	const series = { id: "fixes", universalTransition: true, cursor: "pointer" };
	if (view === "rank") {
		return {
			grid: { top: 16, left: 8, right: 72, bottom: 8 },
			xAxis: { type: "value", name: "", min: 0, max: null, axisLabel: { show: false } }, // bars carry their values
			yAxis: {
				type: "category",
				data: list.map((f) => f.name),
				inverse: true,
				axisLabel: { formatter: "{value}" },
			},
			series: [
				{
					...series,
					type: "bar",
					barWidth: "55%",
					label: { ...label, position: "right" },
					data: list.map((f) => item(f, f.wait)),
				},
			],
		};
	}
	return {
		grid: { top: 40, left: 8, right: 32, bottom: 32 },
		xAxis: {
			type: "value",
			name: "spare time per barista",
			nameLocation: "middle",
			nameGap: 26,
			min: 0,
			max: 80,
			axisLabel: { show: true, formatter: "{value}%" },
		},
		yAxis: { type: "value", data: null, inverse: false, axisLabel: { formatter: "{value} min" } },
		series: [
			{
				...series,
				type: "scatter",
				symbolSize: 22,
				label: { ...label, formatter: (p: Mark) => `${p.name}: ${fmt(p.data.wait)}` },
				// Labels start at their point and run right (left for the far-right point), so none leaves a phone-width chart.
				data: list.map((f) => ({
					...item(f, [+(100 - f.busy * 100).toFixed(1), f.wait]),
					label:
						f.servers === 2
							? { position: "top", align: "right" }
							: { position: f.steady ? "top" : "right", align: "left" },
				})),
			},
		],
	};
}

const VIEWS = [
	["rank", "Ranked"],
	["slack", "Spare time vs wait"],
] as const;

/** The fixes chart: two views of the same five fixes, "change nothing" hidden on request, a click opens the fix's view. */
export function Fixes() {
	const [view, setView] = useState<string>("rank");
	const [hide, setHide] = useState(false);
	const option = useMemo(
		() => ({ tooltip: { show: false }, ...fixOption(view, hide) }),
		[view, hide],
	);
	return (
		<figure class="fig">
			<div class="controls">
				<div class="seg" role="radiogroup" aria-label="Chart view">
					{VIEWS.map(([value, text]) => (
						<label>
							<input
								type="radio"
								name="fview"
								value={value}
								checked={value === view}
								onChange={() => setView(value)}
							/>
							<span>{text}</span>
						</label>
					))}
				</div>
				<label class="toggle">
					<input
						type="checkbox"
						id="hide-none"
						checked={hide}
						onChange={(e) => setHide(e.currentTarget.checked)}
					/>
					<span>Hide “change nothing”</span>
				</label>
			</div>
			<Chart
				id="fixes"
				label="Average wait for five fixes; the second barista is lowest"
				option={option}
				setup={(chart) =>
					chart.on("click", (p) => {
						location.hash = `#fix/${(p.data as { groupId: string }).groupId}`;
					})
				}
			/>
			<figcaption>Click a bar or point to replay the week with that fix.</figcaption>
		</figure>
	);
}

/* ---- Drill-down: one static view per fix (page.mdx); its chart replays the same simulated week with the fix applied. ---- */
const weekday = (v: number) => WEEK[Math.min(4, Math.floor(v / DAY))]?.[0] ?? "";
const at = (v: number) => `${weekday(v)} ${clock(v % DAY)}`;
const weekLine = (days: Day[]) =>
	days.flatMap((d, i) => d.line.slice(0, DAY).map((n, m) => [i * DAY + m, n]));

/** The week before and after fix `id`, as one zoomable chart. */
export function FixWeek({ id }: { id: string }) {
	const f = FIXES.find((x) => x.id === id) ?? NONE;
	const option = useMemo(() => {
		const line = { type: "line", step: "end", showSymbol: false };
		const after = {
			...line,
			name: f.name,
			areaStyle: { opacity: 0.35 },
			color: "var(--ok)",
			data: weekLine(simulateWeek(0.9, f)),
		};
		return {
			grid: { top: 48, left: 8, right: 24, bottom: 56 },
			legend: { top: 8, left: 8 },
			tooltip: {
				trigger: "axis",
				axisPointer: { label: { formatter: (p: Pointer) => at(p.value) } },
			},
			xAxis: {
				type: "value",
				min: 0,
				max: 5 * DAY,
				interval: DAY,
				axisLabel: { formatter: (v: number) => WEEK[v / DAY]?.[0] ?? "" },
			},
			yAxis: { type: "value" },
			dataZoom: [
				{ type: "inside" },
				{ type: "slider", height: 20, bottom: 12, labelFormatter: at },
			],
			series: [
				{
					...line,
					name: "Change nothing",
					areaStyle: { opacity: 0.15 },
					color: "var(--bad)",
					data: weekLine(simulateWeek(0.9)),
				},
				...(f.id === "none" ? [] : [after]),
			],
		};
	}, [f]);
	return (
		<Chart
			class="tall"
			label="People in line over the simulated week, with and without the fix"
			option={option}
		/>
	);
}
