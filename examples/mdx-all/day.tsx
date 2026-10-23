"use client";
/* A summer day hour by hour for a chosen battery size: a Chart and a Stepper inside one client component. */
import { Chart, Stepper } from "kit";
import { useMemo, useState } from "preact/hooks";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const solar = (h: number) => Math.max(0, 6 * 0.8 * Math.sin((Math.PI * (h - 6)) / 14));
const use = (h: number) => 0.35 + (h === 7 || h === 8 ? 0.8 : 0) + (h >= 18 && h <= 21 ? 1.2 : 0);

/** Charge in the battery at the end of each hour, and what the house bought from the grid in it. */
function simulate(capacity: number) {
	let charge = capacity * 0.2;
	return HOURS.map((h) => {
		const net = solar(h) - use(h);
		const moved = net > 0 ? Math.min(net, capacity - charge) : -Math.min(-net, charge);
		charge += moved;
		return { h, charge, bought: net < 0 ? -net + moved : 0 };
	});
}

const PHASES = [
	{ name: "Morning", end: 10 },
	{ name: "Midday", end: 15 },
	{ name: "Evening", end: 22 },
	{ name: "Night", end: 24 },
];
const SIZES = [0, 5, 10];
const kwh = (n: number) => `${n.toFixed(1)} kWh`;

/** The day explorer: a size switch, a stepper through the day's phases, a chart and readouts drawn from the step. */
export function Day() {
	const [size, setSize] = useState(5);
	const [step, setStep] = useState(PHASES.length);
	const hours = useMemo(() => simulate(size), [size]);
	const end = PHASES[step - 1]?.end ?? 24;
	const shown = hours.slice(0, end);
	const bought = shown.reduce((sum, x) => sum + x.bought, 0);
	const option = useMemo(
		() => ({
			grid: { top: 40, left: 8, right: 16, bottom: 8 },
			legend: { top: 8, left: 8 },
			xAxis: { type: "category", data: HOURS.map((h) => `${h}:00`) },
			yAxis: { type: "value", max: 10, axisLabel: { formatter: "{value} kWh" } },
			series: [
				{
					name: "In the battery",
					type: "line",
					areaStyle: { opacity: 0.25 },
					showSymbol: false,
					color: "var(--accent)",
					data: shown.map((x) => +x.charge.toFixed(2)),
				},
				{
					name: "Bought",
					type: "bar",
					color: "var(--bad)",
					data: shown.map((x) => +x.bought.toFixed(2)),
				},
			],
		}),
		[shown],
	);
	return (
		<Stepper
			id="day"
			label="A summer day, phase by phase"
			onStep={setStep}
			captions={PHASES.map(
				(p, i) =>
					`${p.name}, to ${p.end}:00: ${kwh(hours[p.end - 1]?.charge ?? 0)} in the battery, ${kwh(
						hours.slice(PHASES[i - 1]?.end ?? 0, p.end).reduce((sum, x) => sum + x.bought, 0),
					)} bought.`,
			)}
		>
			<div class="controls">
				<div class="seg" role="radiogroup" aria-label="Battery size">
					{SIZES.map((s) => (
						<label>
							<input
								type="radio"
								name="day-size"
								id={`day-size-${s}`}
								value={s}
								checked={s === size}
								onChange={() => setSize(s)}
							/>
							<span>{s ? `${s} kWh` : "None"}</span>
						</label>
					))}
				</div>
			</div>
			<dl class="stats">
				<div class="stat">
					<dt>Bought so far</dt>
					<dd>{kwh(bought)}</dd>
				</div>
				<div class="stat">
					<dt>In the battery</dt>
					<dd>{kwh(shown.at(-1)?.charge ?? 0)}</dd>
				</div>
			</dl>
			<Chart label="Battery charge and grid purchases by hour" option={option} />
		</Stepper>
	);
}
