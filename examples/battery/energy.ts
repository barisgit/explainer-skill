/*
 * The illustrative house and roof every figure on the page reads: a 6 kW roof and a four-person house, month by month.
 * None of it is measured.
 */

export const MONTHS = [
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
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** kWh the roof makes and the house uses in each month. */
export const MADE = [180, 260, 420, 610, 740, 790, 820, 720, 540, 360, 200, 150];
export const USED = [520, 470, 450, 400, 370, 350, 360, 370, 390, 430, 480, 530];
/** Hours the roof produces on a day of each month, centred on 13:00. */
const DAYLIGHT = [8.7, 10, 11.6, 13.2, 14.6, 15.3, 15, 13.7, 12.1, 10.5, 9.1, 8.3];
/** A tenth of what goes into the battery is lost on the way. */
export const EFFICIENCY = 0.9;

/** kW the house draws from 23:00 to 06:00, by day, at breakfast (07 to 09) and in the evening (18 to 22). */
const LOAD = { night: 0.1, day: 0.3, breakfast: 0.5, evening: 0.85 };
/** kWh a day those take; every month uses more, and the rest is spread over 08 to 18. */
const SHAPE_KWH = 7 * LOAD.night + 17 * LOAD.day + 2 * LOAD.breakfast + 4 * LOAD.evening;

/** The item at `i`; the page's tables are fixed, so a missing one is a mistake in this code. */
export function at<T>(list: readonly T[], i: number): T {
	const item = list[i];
	if (item === undefined) {
		throw new RangeError(`no item ${i} of ${list.length}`);
	}
	return item;
}

const hourOf = (t: number) => ((t % 24) + 24) % 24;

/** The house's power in kW at hour t of a day in `month` (0 for January). */
export function house(t: number, month: number) {
	const h = hourOf(t);
	const rest = at(USED, month) / at(DAYS, month) - SHAPE_KWH;
	return (
		(h >= 23 || h < 6 ? LOAD.night : LOAD.day) +
		(h >= 7 && h < 9 ? LOAD.breakfast : 0) +
		(h >= 18 && h < 22 ? LOAD.evening : 0) +
		(h >= 8 && h < 18 ? rest / 10 : 0)
	);
}

/** The roof's power in kW at hour t on a day of `month` with `sun` times the month's average sunshine. */
export function roof(t: number, month: number, sun = 1) {
	const h = hourOf(t);
	const len = at(DAYLIGHT, month);
	const rise = 13 - len / 2;
	if (h < rise || h > rise + len) {
		return 0;
	}
	const daily = (at(MADE, month) / at(DAYS, month)) * sun;
	return ((daily * Math.PI) / (2 * len)) * Math.sin((Math.PI * (h - rise)) / len);
}

/** "06:45" for hour 30.75. */
export function clock(t: number) {
	const m = Math.round(hourOf(t) * 60);
	return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** One decimal, as the figures write kWh. */
export const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
/** "€4,200", as the kit's tables write euro. */
export const euro = (n: number) => `€${n.toLocaleString("en")}`;
