/*
 * The money: the installer's quotes, and one illustrative year run quarter hour by quarter hour through each battery size.
 * Every number the page states about savings and payback is computed here.
 */
import { at, DAYS, EFFICIENCY, house, MONTHS, roof, USED } from "./energy.ts";

/** What the 5 kWh quote is made of; `tag` numbers the part in the system drawing. */
export const PARTS = [
	{
		tag: 1,
		ref: "bat",
		part: "5 kWh battery",
		note: "LFP cells rated for 6,000 cycles",
		price: 2600,
	},
	{
		tag: 2,
		ref: "inv",
		part: "Hybrid inverter",
		note: "replaces the roof's own inverter",
		price: 750,
	},
	{ tag: 3, ref: "meter", part: "Two-way meter", note: "swapped by the grid operator", price: 310 },
	{
		tag: 0,
		ref: "",
		part: "Electrician, 6 h",
		note: "mounting, wiring, commissioning",
		price: 540,
	},
];
/** The installer's three quotes. */
export const QUOTES = [
	{ kwh: 5, price: PARTS.reduce((sum, p) => sum + p.price, 0) },
	{ kwh: 10, price: 7900 },
	{ kwh: 15, price: 11200 },
];
/** Euro per kWh bought from the grid, and paid for a kWh sold to it. */
export const TARIFF = { buy: 0.4, sell: 0.03 };
/** Full cycles the cells are rated for. */
export const CYCLES = 6000;
/** Years the cells last at one full cycle a night. */
export const LIFE = Math.round(CYCLES / 365);
/** Daily sun's initial spread about 1, before normalization to keep the month's total fixed. */
export const WEATHER = 0.6;

/** A repeatable sequence of numbers in [0, 1), so every pack draws the same weather. */
function random(seed: number) {
	let s = seed;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
/** Each day's sun as a share of its month's average; every month's days average exactly 1. */
const SUN = (() => {
	const next = random(7);
	return DAYS.map((n) => {
		const days = Array.from({ length: n }, () => 1 - WEATHER + 2 * WEATHER * next());
		const mean = days.reduce((a, b) => a + b, 0) / n;
		return days.map((d) => d / mean);
	});
})();

const STEP = 0.25;
type Month = { delivered: number; bought: number; sold: number };

/** A year with a battery of `capacity` kWh: surplus fills it and loses a tenth on the way, a shortfall empties it before the grid is asked. */
function year(capacity: number): Month[] {
	let stored = 0;
	return SUN.map((days, m) => {
		const month = { delivered: 0, bought: 0, sold: 0 };
		for (const sun of days) {
			for (let t = STEP / 2; t < 24; t += STEP) {
				const net = (roof(t, m, sun) - house(t, m)) * STEP;
				if (net > 0) {
					const charged = Math.min(net, (capacity - stored) / EFFICIENCY);
					stored += charged * EFFICIENCY;
					month.sold += net - charged;
				} else {
					const given = Math.min(-net, stored);
					stored -= given;
					month.delivered += given;
					month.bought += -net - given;
				}
			}
		}
		return month;
	});
}

const RUNS = [0, 5, 10, 15].map(year);
/** The year with `blocks` 5 kWh blocks installed. */
const run = (blocks: number) => at(RUNS, blocks);
const total = (run: Month[], key: keyof Month) => run.reduce((sum, m) => sum + m[key], 0);
/** Euro a year a battery saves against none: what it no longer buys, less what it no longer sells. */
const saving = (withBattery: Month[]) =>
	(total(run(0), "bought") - total(withBattery, "bought")) * TARIFF.buy -
	(total(run(0), "sold") - total(withBattery, "sold")) * TARIFF.sell;

/** Each 5 kWh block: what it adds to the price and to the yearly saving, and the years it takes to repay itself. */
export const BLOCKS = QUOTES.map((q, i) => {
	const cost = q.price - (i ? at(QUOTES, i - 1).price : 0);
	const saves = Math.round(saving(run(i + 1)) - saving(run(i)));
	return {
		name: at(["first 5 kWh", "second 5 kWh", "third 5 kWh"], i),
		cost,
		saves,
		years: Math.round(cost / saves),
	};
});

/** Each quoted size whole, as the rows the reader chooses from, buying none last. */
export const SIZES: {
	size: string;
	price?: number;
	saves?: number;
	years?: number;
	own?: number;
}[] = [
	...QUOTES.map((q, i) => {
		const saves = Math.round(saving(run(i + 1)));
		return {
			size: `${q.kwh} kWh`,
			price: q.price,
			saves,
			years: Math.round(q.price / saves),
			/** Share of the house's year that does not come from the grid. */
			own: 1 - total(run(i + 1), "bought") / USED.reduce((a, b) => a + b, 0),
		};
	}),
	{ size: "None yet" },
];

/** kWh each block hands the house in each month: the first 5 kWh, then what the second and third add. */
const BY_MONTH = [1, 2, 3].map((i) =>
	run(i).map((m, j) => Math.round(m.delivered - at(run(i - 1), j).delivered)),
);
/** What the second block adds, month by month. */
const SECOND = at(BY_MONTH, 1);
const SEASON = [
	"winter",
	"winter",
	"spring",
	"spring",
	"spring",
	"summer",
	"summer",
	"summer",
	"autumn",
	"autumn",
	"autumn",
	"winter",
];
/** The seasons of the months in which the second block delivers at least a fifth of what it does in its busiest one. */
export const SECOND_SEASONS = [
	...new Set(
		MONTHS.flatMap((_, j) => (at(SECOND, j) >= Math.max(...SECOND) / 5 ? [at(SEASON, j)] : [])),
	),
];
/** The second block's busiest month, where the month figure starts. */
export const BUSIEST = at(MONTHS, SECOND.indexOf(Math.max(...SECOND)));

/** The month figure: what the second and third blocks add, month by month, stacked; the picked month's values in the key. */
export function months(_month: string) {
	return {
		plot: {
			categories: MONTHS,
			stack: true,
			series: [1, 2].map((i) => ({
				name: at(BLOCKS, i).name,
				type: "bar",
				data: BY_MONTH[i],
				fill: ["hollow", "hatch"][i - 1],
			})),
			y: { step: 10, format: { unit: "kWh" } },
		},
	};
}
