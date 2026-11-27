import { needs, options, standing } from "./db.ts";

/** One toggle per need; the options' rows take the standing of the needs switched on. */
export const controls = needs.map((n) => ({
	id: `need-${n.id}`,
	label: n.label,
	toggle: true,
	value: n.id === "iso" || n.id === "ha",
}));

export function needsFrame(...on: boolean[]) {
	const picked = needs.filter((_, i) => on[i]).map((n) => n.id);
	if (picked.length === 0) {
		return { readout: "Switch on what you need; the rows that cannot give it fade." };
	}
	const states = Object.fromEntries(options.map((o) => [o.id, standing(o, picked)]));
	const fits = options.filter((o) => states[o.id] === "fit").map((o) => o.name);
	const readout =
		fits.length === 0
			? "No option meets all of these without a compromise."
			: `Meets all of them: ${fits.join(", ")}.`;
	return { states, readout };
}
