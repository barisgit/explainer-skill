/**
 * Renders a ```schematic block at pack time to one inline SVG. The first line picks the dialect and may name the drawing for
 * screen readers: `draw` (draw.ts, the author lays the drawing out) or `netlist` (netlist.ts: parts placed at `@x,y` or by a pin
 * relative to another part's pin are wired by the grid router, a netlist with no positions is placed and wired by ELK). Every
 * part carries its name as a data-ref, every named net its name, every ground `gnd`.
 */
import {
	drawnNets,
	geometryProblems,
	junctions,
	netProblems,
	type Stats,
	statsOf,
} from "./audit.ts";
import { drawScene, strayContacts } from "./draw.ts";
import { elkLayout } from "./elk.ts";
import { placeLabels } from "./labels.ts";
import { groundsFor, type NetPart, netsOf, parseNetlist, words } from "./netlist.ts";
import { renderSvg } from "./render.ts";
import { routeNets } from "./route.ts";
import type { Scene } from "./scene.ts";

export interface Schematic {
	svg: string;
	refs: string[];
	/** What the author must fix: wires through parts, unmeant contacts, shorts, labels with no free spot. */
	problems: string[];
	stats: Stats & { nets: number; layout: "draw" | "grid" | "elk" };
}

/** A netlist's scene: routed on the grid when every part is placed, laid out by ELK when none is. */
function netlistScene(lines: string[]): {
	scene: Scene;
	problems: string[];
	layout: "grid" | "elk";
} {
	const { parts, errors } = parseNetlist(lines);
	const placed = parts.filter((p) => p.placed && p.kind !== "ground");
	if (placed.length && placed.length < parts.length) {
		const loose = parts.filter((p) => !p.placed).map((p) => p.id);
		errors.push(
			`place every part (@x,y or pin@Part.pin dx,dy) or none; not placed: ${loose.join(", ")}`,
		);
	}
	const layout = placed.length ? "grid" : "elk";
	const wires = layout === "grid" ? routeNets(parts, netsOf(parts), errors) : elkLayout(parts);
	const grounds = groundsFor(parts as NetPart[]);
	const namedNets = new Set(netsOf(parts).keys());
	const scene: Scene = {
		parts: [...parts, ...grounds.grounds],
		wires: [...wires, ...grounds.wires],
		namedNets,
	};
	return { scene, problems: [...errors, ...netProblems(scene)], layout };
}

/** Draws one schematic block; throws only for an unknown dialect, and reports everything else the author must fix as problems. */
export function renderSchematic(source: string): Schematic {
	const [head = "", ...body] = source.trim().split("\n");
	const [dialect, ...title] = words(head);
	let scene: Scene;
	let problems: string[];
	let layout: Schematic["stats"]["layout"];
	if (dialect === "draw") {
		const drawn = drawScene(body);
		scene = drawn.scene;
		problems = [...drawn.errors, ...strayContacts(drawn.scene, drawn.meant)];
		layout = "draw";
	} else if (dialect === "netlist") {
		({ scene, problems, layout } = netlistScene(body));
	} else {
		throw new Error(`a schematic starts with draw or netlist, not "${dialect}"`);
	}
	const dots = junctions(scene);
	const labels = placeLabels(scene, dots);
	problems.push(...geometryProblems(scene, dots, labels));
	const svg = renderSvg(scene, dots, labels, title.join(" ") || "Schematic");
	const refs = [...new Set([...scene.parts.map((p) => p.id), ...(scene.namedNets ?? [])])];
	return {
		svg,
		refs,
		problems,
		stats: { ...statsOf(scene), nets: drawnNets(scene).length, layout },
	};
}
