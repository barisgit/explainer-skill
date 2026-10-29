/**
 * Renders a ```schematic block at pack time to one inline SVG: the block is a netlist (netlist.ts) whose parts are placed
 * relative to each other (place.ts), wired by the grid router (route.ts), labelled (labels.ts) and checked (check.ts). Every part
 * carries its name as a data-ref, every wire its net's name and the parts it joins, every ground `gnd`.
 */
import { overlappingParts, problemsOf } from "./check.ts";
import { placeLabels } from "./labels.ts";
import { parseNetlist } from "./netlist.ts";
import { groundsFor, netsOf } from "./nets.ts";
import { placeParts } from "./place.ts";
import { refsOf, renderSvg } from "./render.ts";
import { routeNets } from "./route.ts";
import { junctions, type Stats, statsOf } from "./topology.ts";

export interface Schematic {
	svg: string;
	/** The data-ref values the drawing carries, which prose may link to. */
	refs: string[];
	/** What the author must fix, each naming its line; a drawing with any fails pack. */
	problems: string[];
	stats: Stats;
}

/** Draws one schematic block's source. */
export function renderSchematic(source: string): Schematic {
	const { title, parts, errors } = parseNetlist(source);
	errors.push(...placeParts(parts));
	if (!errors.length) {
		// Parts on top of each other leave the router no way through; say so instead of listing its failures.
		errors.push(...overlappingParts(parts));
	}
	const grounds = groundsFor(parts);
	const all = [...parts, ...grounds.grounds];
	const wired = errors.length ? [] : routeNets(all, netsOf(parts), grounds.wires, errors);
	const scene = { parts: all, wires: [...wired, ...grounds.wires] };
	const dots = junctions(scene);
	const labels = placeLabels(scene, dots);
	const problems = errors.length ? errors : [...errors, ...problemsOf(scene, dots, labels)];
	return {
		svg: renderSvg(scene, dots, labels, title),
		refs: refsOf(scene),
		problems,
		stats: statsOf(scene),
	};
}
