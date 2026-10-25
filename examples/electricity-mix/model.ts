/* The electricity extract (data.json, written by extract.py) and every number the page shows, as pure functions of it.
   page.mdx renders the world table from it when it packs; figures.tsx redraws the figures from it in the browser. */
import data from "./data.json";

/** A place in the extract: OWID's reported total and one series per source, in TWh, one value per year; null where blank. */
export interface Place {
	name: string;
	slug: string;
	region: boolean;
	total: (number | null)[];
	twh: (number | null)[][];
}

/** A band of the stacked mix: a source, or the generation no source accounts for. */
export interface Part {
	id: string;
	name: string;
	color: string;
}

/** A source, `at` its column in the extract. */
export interface Source extends Part {
	at: number;
}

export const Y0 = data.first;
export const Y1 = data.last;
export const YEARS = Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i);

export const COAL: Source = { id: "coal", name: "Coal", at: 0, color: "var(--s-coal)" };
// Stack order runs bottom to top: fossil fuels, then nuclear, then renewables.
export const SOURCES: Source[] = [
	COAL,
	{ id: "oil", name: "Oil and other fossil", at: 2, color: "var(--s-oil)" },
	{ id: "gas", name: "Gas", at: 1, color: "var(--s-gas)" },
	{ id: "nuclear", name: "Nuclear", at: 3, color: "var(--s-nuclear)" },
	{ id: "hydro", name: "Hydro", at: 4, color: "var(--s-hydro)" },
	{ id: "wind", name: "Wind", at: 5, color: "var(--s-wind)" },
	{ id: "solar", name: "Solar", at: 6, color: "var(--s-solar)" },
	{ id: "bio", name: "Bioenergy", at: 7, color: "var(--s-bio)" },
	{ id: "other", name: "Other renewables", at: 8, color: "var(--s-other)" },
];
/** Generation the release reports in a total but does not split by source (Europe and the EU, 2000 to 2003). */
export const REST: Part = { id: "rest", name: "Not itemised", color: "var(--rule-strong)" };

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** Regions first (World leading), then countries by name, as extract.py sorts them. */
export const PLACES: Place[] = data.places.map((p) => ({ ...p, slug: slug(p.name) }));
export const COUNTRIES = PLACES.filter((p) => !p.region);
const bySlug = new Map(PLACES.map((p) => [p.slug, p]));
export const placeOf = (key: string) => bySlug.get(key);

const world = bySlug.get("world");
if (!world) {
	throw new Error("data.json has no World row: rerun extract.py");
}
export const WORLD = world;

/* ---- Values. Blank cells stay null; totals are OWID's reported totals. ---- */

/** OWID's reported total in TWh: null where the place has no data that year, possibly 0. */
export const total = (p: Place, year: number) => p.total[year - Y0] ?? null;
/** A source's value as the release gives it, blank as null. */
export const raw = (p: Place, src: Source, year: number) => p.twh[src.at]?.[year - Y0] ?? null;
const reported = (p: Place, year: number) =>
	SOURCES.reduce((sum, s) => sum + (raw(p, s, year) ?? 0), 0);
/** The part of the total the listed sources do not account for. */
const rest = (p: Place, year: number) => {
	const t = total(p, year);
	return t === null ? null : t - reported(p, year);
};
/** A year is itemised when the sources add up to the total within rounding (0.1%). */
export const itemised = (p: Place, year: number) => {
	const t = total(p, year);
	return t !== null && Math.abs(t - reported(p, year)) <= Math.max(0.01, 0.001 * t);
};
/** Years with a total that the sources do not account for. */
export const partialYears = (p: Place) =>
	YEARS.filter((y) => total(p, y) !== null && !itemised(p, y));
/**
 * A source's TWh. A blank cell counts as zero only in an itemised year, where the other sources already add up to the total;
 * in a partial year it is unknown (null).
 */
export const twh = (p: Place, src: Source, year: number) =>
	raw(p, src, year) ?? (itemised(p, year) ? 0 : null);
export const restTwh = (p: Place, year: number) => (itemised(p, year) ? 0 : rest(p, year));
/** Share of a place's generation in percent; null when the value is unknown or the place generated nothing. */
export const pctOf = (value: number | null, tot: number | null) =>
	value === null || !tot ? null : (100 * value) / tot;
export const share = (p: Place, src: Source, year: number) =>
	pctOf(twh(p, src, year), total(p, year));
/** The summed share of some sources; null when any of them is unknown. */
export function sumShare(p: Place, ids: string[], year: number) {
	let sum = 0;
	for (const s of SOURCES.filter((src) => ids.includes(src.id))) {
		const v = share(p, s, year);
		if (v === null) {
			return null;
		}
		sum += v;
	}
	return sum;
}

/* ---- Text. ---- */

const MINUS = "\u2212";
export const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** TWh with enough digits that a small value never shows as zero. */
export function fmtT(v: number) {
	const a = Math.abs(v);
	if (v === 0) {
		return "0";
	}
	if (a >= 100) {
		return num.format(v);
	}
	return v.toFixed(a >= 1 ? 1 : a >= 0.01 ? 2 : 3);
}
export const pc = (v: number | null, digits = 0) => (v === null ? "–" : `${v.toFixed(digits)}%`);
const sign = (v: number, text: string) => (v > 0 ? `+${text}` : v < 0 ? `${MINUS}${text}` : text);
/** A signed change in TWh. */
export const dT = (v: number) => sign(v, fmtT(Math.abs(v)));
/** A signed change in percentage points. */
export const dP = (v: number) =>
	sign(v, Math.abs(v) >= 0.1 ? Math.abs(v).toFixed(1) : Math.abs(v).toFixed(2));
/** A table cell: "–" for a value the release leaves blank. */
export const cell = (v: number | null, fmt: (v: number) => string) => (v === null ? "–" : fmt(v));
export const list = (names: string[]) => (names.length ? names.join(", ") : "none");
/** Smallest change that counts as a change, in the unit of each measure (the data has 0.001 TWh resolution). */
export const EPS = { twh: 0.0005, share: 0.005 };
export type Unit = keyof typeof EPS;
