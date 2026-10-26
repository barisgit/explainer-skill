"use client";
/* Spike port of examples/electricity-mix's first figure: world generation by source as stacked areas, Amount/Share switch,
   a legend that hides sources, and a tooltip with the year's values and total. */
import { areaY, defineChart } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { TChart } from "kit";
import { useMemo, useState } from "preact/hooks";
import { Seg } from "../../examples/electricity-mix/figures.tsx";
import {
	cell,
	fmtT,
	num,
	type Place,
	partialYears,
	pc,
	pctOf,
	REST,
	restTwh,
	SOURCES,
	total,
	twh,
	type Unit,
	WORLD,
	Y0,
	Y1,
	YEARS,
} from "../../examples/electricity-mix/model.ts";

interface Band {
	source: string;
	year: number;
	value: number | null;
}

const MODES: [Unit, string][] = [
	["twh", "Amount (TWh)"],
	["share", "Share (%)"],
];

function mixChart(place: Place, mode: Unit, hidden: ReadonlySet<string>) {
	const pct = mode === "share";
	const parts = [
		...SOURCES.map((s) => ({ part: s, at: (y: number) => twh(place, s, y) })),
		...(partialYears(place).length ? [{ part: REST, at: (y: number) => restTwh(place, y) }] : []),
	];
	const rows: Band[] = parts
		.filter(({ part }) => !hidden.has(part.name))
		.flatMap(({ part, at }) =>
			YEARS.map((year) => ({
				source: part.name,
				year,
				value:
					total(place, year) === null ? null : pct ? pctOf(at(year), total(place, year)) : at(year),
			})),
		);
	const value = (v: number) => (pct ? pc(v, v >= 10 ? 0 : 1) : `${fmtT(v)} TWh`);
	return defineChart({
		marks: [
			areaY(rows, {
				x: "year",
				y: "value",
				z: "source",
				fillOpacity: 0.88,
				stroke: "var(--surface)",
				strokeWidth: 0.5,
			}),
		],
		scales: {
			x: {
				scale: scaleLinear().domain([Y0, Y1]),
				axis: { ticks: { values: YEARS.filter((y) => y % 4 === 0), format: String } },
			},
			y: {
				scale: pct ? scaleLinear().domain([0, 100]) : scaleLinear,
				nice: !pct,
				grid: true,
				axis: { ticks: { format: (v: number) => (pct ? `${v}%` : num.format(v)) } },
			},
		},
		color: {
			scale: scaleOrdinal<string, string>()
				.domain(parts.map((p) => p.part.name))
				.range(parts.map((p) => p.part.color)),
		},
		focus: "group-x",
		tooltip: {
			use: tooltip,
			items: [
				{
					channel: "x",
					text: (p) => `${p.xValue} · total ${cell(total(place, p.xValue), fmtT)} TWh`,
				},
				{ channel: "y", text: (p) => (p.datum.value === null ? "–" : value(p.datum.value)) },
			],
		},
	});
}

const LEGEND = [...SOURCES, ...(partialYears(WORLD).length ? [REST] : [])];

/** The world mix with its Amount/Share switch. */
export function WorldMixT() {
	const [mode, setMode] = useState<Unit>("twh");
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
	const definition = useMemo(() => mixChart(WORLD, mode, hidden), [mode, hidden]);
	const toggle = (name: string) =>
		setHidden((now) => {
			const next = new Set(now);
			next.has(name) ? next.delete(name) : next.add(name);
			return next;
		});
	return (
		<figure class="fig" id="fig-mix">
			<div class="controls">
				<Seg
					name="mode"
					label="What the chart measures"
					value={mode}
					options={MODES}
					onPick={setMode}
				/>
			</div>
			{/* The kit's own legend (plot.js's look): TanStack's interactive legend reserves 44 px rows inside the chart. */}
			<ul class="plot-legend">
				{LEGEND.map((part) => (
					<li key={part.name}>
						<button
							type="button"
							aria-pressed={!hidden.has(part.name)}
							onClick={() => toggle(part.name)}
						>
							<i class="bar" style={{ "--c": part.color }} />
							{part.name}
						</button>
					</li>
				))}
			</ul>
			<TChart
				id="world"
				class="mix"
				label={`Stacked areas of world electricity generation by source, ${Y0} to ${Y1}`}
				definition={definition}
			/>
			<figcaption>
				World electricity generation by source. Click a legend entry to hide a source, or hover for
				the year's values.
			</figcaption>
		</figure>
	);
}
