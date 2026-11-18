/* The numbers in the page's prose and its second and third figures, computed from the extract. */
import { COUNTRIES, change, latest, SOURCES, WORLD } from "./model.ts";

const step = latest(WORLD);
if (!step) {
	throw new Error("data.json has no world change for the last year");
}
export const WS = step.windSolar;
export const TOTAL = step.total;
export const REST = TOTAL - WS;
export const COAL = step.coal;

/** What each source added to world generation in the last year, wind and solar apart, largest first. */
export const BY_SOURCE = SOURCES.flatMap((s) => {
	const v = change(WORLD, s.id);
	return v === null
		? []
		: [{ id: s.id, name: s.name, value: v, windSolar: s.id === "wind" || s.id === "solar" }];
}).sort((a, b) => b.value - a.value);
export const OTHERS = BY_SOURCE.filter((s) => !s.windSolar);

/** Countries whose coal generation fell or rose into the last year, and by how much in all. */
const coal = COUNTRIES.map((p) => ({
	name: p.name,
	coal: latest(p)?.coal ?? 0,
	windSolar: latest(p)?.windSolar ?? 0,
}));
const fell = coal.filter((c) => c.coal < 0);
const rose = coal.filter((c) => c.coal > 0);
const total = (rows: typeof coal) => rows.reduce((s, c) => s + c.coal, 0);
export const FELL = { n: fell.length, twh: total(fell) };
export const ROSE = { n: rose.length, twh: total(rose) };
/** The countries that moved coal most each way (four risers, four fallers), risers first. */
export const MOVERS = [
	...[...coal].sort((a, b) => b.coal - a.coal).slice(0, 4),
	...[...coal]
		.sort((a, b) => a.coal - b.coal)
		.slice(0, 4)
		.reverse(),
];
