/*
 * A typical July day, every day alike, and what a battery of a given size moves from midday to the evening:
 * the precomputed frame of the day figure.
 */
import { clock, EFFICIENCY, house, r1, roof } from "./energy.ts";

const JUL = 6;
const DT = 1 / 60;
const scan = (from: number, covered: boolean) => {
	let t = from;
	while (roof(t, JUL) > house(t, JUL) !== covered) {
		t += DT;
	}
	return t;
};
/** When the roof starts covering the house in the morning, and stops in the evening. */
const sunUp = scan(4, true);
const sunDown = scan(14, false);

/** Running totals, minute by minute over 24 hours from sunUp, of the roof's surplus and the house's shortfall. */
const surplus = [0];
const shortfall = [0];
let surplusSum = 0;
let shortfallSum = 0;
for (let i = 0; i < 24 / DT; i++) {
	const t = sunUp + (i + 0.5) * DT;
	const net = roof(t, JUL) - house(t, JUL);
	surplusSum += Math.max(0, net) * DT;
	shortfallSum += Math.max(0, -net) * DT;
	surplus.push(surplusSum);
	shortfall.push(shortfallSum);
}
/** The hour a running total reaches e kWh, or `start` for none. */
const when = (cum: number[], e: number, start: number) => {
	const i = cum.findIndex((v) => v >= e - 1e-9);
	return e <= 0 || i < 0 ? start : sunUp + i * DT;
};
const daily = (f: (t: number) => number) => {
	let sum = 0;
	for (let t = DT / 2; t < 24; t += DT) {
		sum += f(t) * DT;
	}
	return sum;
};

export const JULY = {
	made: daily((t) => roof(t, JUL)),
	used: daily((t) => house(t, JUL)),
	/** What the house needs from the roof falling short in the evening to the roof covering it again in the morning. */
	night: shortfallSum,
	surplus: surplusSum,
	sunDown,
};

/** The lines, every quarter hour from 06:00 to 06:00. */
const HOURS = Array.from({ length: 97 }, (_, i) => 6 + i / 4);
const LINES = [
	{
		name: "Roof",
		data: HOURS.map((t) => [t, +roof(t, JUL).toFixed(3)]),
		color: "var(--muted)",
		dash: false,
	},
	{
		name: "House",
		data: HOURS.map((t) => [t, +house(t, JUL).toFixed(3)]),
		color: "var(--ink)",
		dash: false,
	},
];

/** The July day with a battery of `size` kWh: what it stores and hands back, the first 5 kWh solid, the rest hollow. */
export function july(size: number) {
	const moved = Math.min(size, JULY.night);
	const firstIn = when(surplus, Math.min(moved, 5) / EFFICIENCY, sunUp);
	const full = when(surplus, moved / EFFICIENCY, sunUp);
	const empty = moved >= JULY.night ? sunUp + 24 : when(shortfall, moved, sunDown);
	const firstOut = moved <= 5 ? empty : when(shortfall, 5, sunDown);
	const sold = JULY.surplus - moved / EFFICIENCY;
	const bought = JULY.night - moved;
	const spare = size - moved;
	return {
		plot: {
			legend: false,
			x: { min: 6, max: 30, labels: [6, 12, 18, 24, 30].map(clock) },
			y: { labels: false },
			series: LINES,
			marks: [
				{ x: [sunUp, firstIn], between: ["Roof", "House"], fill: "accent" },
				{ x: [firstIn, full], between: ["Roof", "House"], fill: "hollow" },
				{ x: [sunDown, firstOut], between: ["House", "Roof"], fill: "accent" },
				{ x: [firstOut, empty], between: ["House", "Roof"], fill: "hollow" },
				{ x: [empty, sunUp + 24], between: ["House", "Roof"], fill: true },
				{ at: [15.5, roof(15.5, JUL)], label: `roof makes ${r1(JULY.made)} kWh` },
				{ at: [20, house(20, JUL)], label: `house uses ${r1(JULY.used)} kWh` },
				{
					x: [Math.max(full, 10), sunDown],
					between: ["Roof", "House"],
					label: `sold ${r1(sold)} kWh`,
				},
				{
					x: [sunDown, sunUp + 24],
					label:
						size === 0
							? `bought ${r1(bought)} kWh`
							: bought > 0.05
								? `battery until ${clock(empty)}, then bought ${r1(bought)} kWh`
								: `battery all night, ${r1(spare)} kWh never used`,
				},
				...(size > 0
					? [{ at: [full, roof(full, JUL)], label: `battery full ${clock(full)}` }]
					: []),
			],
		},
	};
}
