import data from "./data.json";

export const years = data.years;
export const dayLabels = data.days.map((d) => d.label);
const hours = (v: number[]) => v.map((y, h) => [h, y]);
function find(label: string) {
	const day = data.days.find((d) => d.label === label);
	if (!day) {
		throw new Error(`no day labelled ${label}`);
	}
	return day;
}
const sign = (n: number) => (n < 0 ? `−${Math.abs(Math.round(n))}` : `${Math.round(n)}`);

export function priceFrame(label: string) {
	const d = find(label);
	const neg = d.price.filter((p) => p < 0).length;
	const low = Math.min(...d.price);
	const at = d.price.indexOf(low);
	return {
		plot: {
			series: [{ name: "Price", color: "var(--accent)", width: 2.5, data: hours(d.price) }],
			x: { min: 0, max: 23, step: 3, format: { digits: 0 } },
			y: { name: "EUR/MWh", format: { digits: 0 } },
			marks:
				neg > 0
					? [{ at: [at, low], label: `${sign(low)} EUR/MWh` }]
					: [{ at: [at, low], label: `lowest: ${sign(low)}` }],
		},
		readout:
			neg > 0
				? `${d.label} (${d.why}): ${neg} negative hours`
				: `${d.label} (${d.why}): no negative hour`,
	};
}

export function supplyFrame(label: string) {
	const d = find(label);
	return {
		plot: {
			series: [
				{ name: "Demand", color: "var(--ink)", data: hours(d.load) },
				{ name: "Solar", data: hours(d.solar) },
				{ name: "Wind", data: hours(d.wind) },
			],
			x: { min: 0, max: 23, step: 3, name: "hour of day (local time)", format: { digits: 0 } },
			y: { min: 0, max: 70, name: "GW", format: { digits: 0 } },
		},
	};
}

export const heat = data.heat;
export const months = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
export const hourNames = Array.from({ length: 24 }, (_, h) => String(h));
export const rlBins = data.rl.filter((b) => b.lo >= -5 && b.lo < 40 && b.share !== null);
export const depth = data.depth;
export const depthTotal = data.depth.reduce((a, b) => a + b.n, 0);
export const depthNames = [
	"below −100",
	"−100 to −50",
	"−50 to −20",
	"−20 to −10",
	"−10 to −5",
	"−5 to −1",
	"−1 to 0",
];
export const wd = data.wd;
export const cls = data.cls;
export const avg = data.avg;
export const low = data.low;
