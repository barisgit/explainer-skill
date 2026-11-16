/* A typical July day for a 5 kWh battery, every quarter hour from 06:00 to the next 06:00: what the roof makes and the house uses,
   and when the battery is full and empty, for the annotated area Plot. */
const STEP = 0.25;
const HOURS = Array.from({ length: 97 }, (_, i) => 6 + i * STEP);
const roof = (t: number) => Math.max(0, 3 * Math.sin((Math.PI * (t - 6)) / 14));
const house = (t: number) => {
	const h = t % 24;
	return 0.3 + (h >= 7.5 && h < 9.5 ? 0.5 : 0) + (h >= 18 && h < 22 ? 0.85 : 0);
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const clock = (t: number) => {
	const m = Math.round((t % 24) * 60);
	return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** The first quarter hour by which the running total of f's positive part, from `from`, reaches `target` kWh. */
function reached(f: (t: number) => number, target: number, from: number) {
	let sum = 0;
	for (const t of HOURS.filter((t) => t >= from)) {
		sum += Math.max(0, f(t)) * STEP;
		if (sum >= target) {
			return t;
		}
	}
	return 30;
}

const BATTERY = 5;
const starts = HOURS.find((t) => roof(t) > house(t)) ?? 6;
const ends = HOURS.find((t) => t > 12 && roof(t) < house(t)) ?? 20;
const full = reached((t) => roof(t) - house(t), BATTERY / 0.9, starts);
const empty = reached((t) => house(t) - roof(t), BATTERY, ends);
const made = HOURS.reduce((sum, t) => sum + roof(t) * STEP, 0);
const used = HOURS.reduce((sum, t) => sum + house(t) * STEP, 0);

export const JULY = {
	legend: false,
	x: { step: 6, format: { unit: "h" } },
	series: [
		{ name: "Roof", data: HOURS.map((t) => [t, r1(roof(t) * 100) / 100]) },
		{ name: "House", data: HOURS.map((t) => [t, house(t)]), color: "var(--ink)", dash: false },
	],
	marks: [
		{ x: [starts, full], between: ["Roof", "House"], fill: "accent" },
		{ x: [ends, empty], between: ["House", "Roof"], fill: "hollow" },
		{ x: [empty, 30], between: ["House", "Roof"], fill: "hatch" },
		{ x: [full, ends], between: ["Roof", "House"], label: "surplus goes to the grid" },
		{ at: [full, roof(full)], label: `battery full ${clock(full)}` },
		{ at: [15.5, roof(15.5)], label: `the roof makes ${r1(made)} kWh` },
		{ at: [19, house(19)], label: `the house uses ${r1(used)} kWh` },
		{ x: [ends, empty], label: `on the battery until ${clock(empty)}` },
	],
};

/** kWh in the battery, hour by hour from 10 % until full, at a charger of `kw` kW (charging slows past 80 %). */
function charge(kw: number): [number, number][] {
	const points: [number, number][] = [[0, 1]];
	for (let [t, e] = [0, 1]; e < 10; ) {
		const step = Math.min(e < 8 ? kw / 4 : kw / 12, 10 - e);
		[t, e] = [t + 0.25, e + step];
		points.push([t, +e.toFixed(2)]);
	}
	return points;
}
/** A line's labels: none but the last, the hours it took. */
const hours = (points: [number, number][]) =>
	points.map(([x], i) => (i === points.length - 1 ? `${x.toFixed(1)} h` : ""));
const [slow, fast] = [charge(3), charge(11)];

/** Two chargers' curves, each ending in its name and the hours it takes: "3 kW: 3.8 h". */
export const CHARGE = {
	series: [
		{ name: "3 kW", data: slow, color: "var(--accent)", dash: false, label: hours(slow) },
		{ name: "11 kW", data: fast, dash: false, label: hours(fast) },
	],
	marks: [{ y: 8, label: "80 %: charging slows" }],
	x: { min: 0, format: { unit: "h" } },
	y: { min: 0, max: 10, format: { unit: "kWh" } },
};
