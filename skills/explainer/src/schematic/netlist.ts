/**
 * The netlist text of a schematic block: one part per line in SPICE's order (name, nodes, value), then where it goes. Connections
 * are stated, never drawn, so the picture always matches the circuit. `kit schematic` prints the author's reference (doc.ts).
 */
import { type Orientation, type Point, UPRIGHT } from "./geometry.ts";
import { type IcSides, ic } from "./ic.ts";
import { OPEN_NET } from "./nets.ts";
import { type Part, plain } from "./scene.ts";
import { G, KINDS, LETTERS, type SymbolDef } from "./symbols.ts";

/** Where a part goes: at a sheet position, or its pin on a pin of another part, `offset` away. */
export interface Placement {
	at?: Point;
	relative?: { pin?: string; part: string; anchor: string; offset: Point };
}

/** A part as the netlist states it, before it is placed. */
export interface NetPart extends Part {
	placement: Placement;
}

const SIDES = new Set(["left", "right", "top", "bottom"]);
const ORIENT: Record<string, Orientation> = {
	h: UPRIGHT,
	v: { rot: 90, flip: false },
	r90: { rot: 90, flip: false },
	r180: { rot: 180, flip: false },
	r270: { rot: 270, flip: false },
};
const KEYWORDS = new Set([...Object.keys(KINDS), "ic"]);
const NUMBER = "(-?\\d+(?:\\.\\d+)?)";
const ABSOLUTE = new RegExp(`^@${NUMBER},${NUMBER}$`);
const RELATIVE = /^([^@]*)@([^.]+)\.(.+)$/;
const OFFSET = new RegExp(`^${NUMBER},${NUMBER}$`);

/** Splits a line into words, keeping "quoted text" (and name="quoted"=net pairs) whole, quotes removed. */
export function words(line: string): string[] {
	return [...line.matchAll(/(?:"[^"]*"|[^\s"])+/g)].map((m) => m[0].replace(/"/g, ""));
}

/** A placement word and the offset word after it, if there is one. */
function relativeOf(rel: RegExpExecArray, next: string | undefined): [Placement, number] {
	const offset = OFFSET.exec(next ?? "");
	return [
		{
			relative: {
				part: rel[2] ?? "",
				anchor: rel[3] ?? "",
				offset: { x: Number(offset?.[1] ?? 0) * G, y: Number(offset?.[2] ?? 0) * G },
				...(rel[1] ? { pin: rel[1] } : {}),
			},
		},
		offset ? 2 : 1,
	];
}

/** What one word of a line is as a placement, and how many words it takes (`@x,y`, `pin@Part.pin [dx,dy]`); 0 for other words. */
function placementWord(word: string, next: string | undefined): [Placement, number] {
	const abs = ABSOLUTE.exec(word);
	if (abs) {
		return [{ at: { x: Number(abs[1]) * G, y: Number(abs[2]) * G } }, 1];
	}
	const rel = RELATIVE.exec(word);
	return rel ? relativeOf(rel, next) : [{}, 0];
}

/** A line's words without its placement, the placement, and the orientation words (parts that can turn only). */
function splitPlacement(tokens: string[], turns: boolean) {
	let placement: Placement = {};
	let o = UPRIGHT;
	const rest: string[] = [];
	for (let i = 0; i < tokens.length; ) {
		const word = tokens[i] ?? "";
		const [found, taken] = placementWord(word, tokens[i + 1]);
		const turn = turns ? ORIENT[word] : undefined;
		if (taken) {
			placement = found;
		} else if (word === "flip" && turns) {
			o = { ...o, flip: true };
		} else if (turn) {
			o = { ...turn, flip: o.flip };
		} else {
			rest.push(word);
		}
		i += taken || 1;
	}
	return { placement, o, rest };
}

/** What is wrong with writing the pin `name` again after `written` (pin keys to the names first written), if anything; records it. */
function repeated(written: Map<string, string>, name: string): string | undefined {
	const first = written.get(plain(name));
	written.set(plain(name), first ?? name);
	return first === undefined
		? undefined
		: `pin ${name} is listed twice${first === name ? "" : `, as ${first} and ${name}`}; each pin of an IC has one name and one net`;
}

/**
 * The pins of an IC line: side keywords, each followed by name=net words (a bare name is a pin left open); the rest is its type.
 * A pin written twice, or under names that mean one pin (V_{CC} and VCC), is an error: the second would drop the first's net.
 */
function icPins(rest: string[]): {
	sides: IcSides;
	nets: Record<string, string>;
	type: string;
	errors: string[];
} {
	const sides: IcSides = { left: [], right: [], top: [], bottom: [] };
	const nets: Record<string, string> = {};
	const type: string[] = [];
	const errors: string[] = [];
	const written = new Map<string, string>();
	let side: keyof IcSides | undefined;
	for (const word of rest) {
		if (SIDES.has(word)) {
			side = word as keyof IcSides;
		} else if (side) {
			const eq = word.lastIndexOf("=");
			const name = eq > 0 ? word.slice(0, eq) : word;
			const again = repeated(written, name);
			if (again) {
				errors.push(again);
			}
			sides[side].push(name);
			nets[name] = eq > 0 ? word.slice(eq + 1) : OPEN_NET;
		} else {
			type.push(word);
		}
	}
	return { sides, nets, type: type.join(" "), errors };
}

/** A part's symbol, nets and value from the words after its placement; an IC names its pins, other parts list nodes in order. */
function wiringOf(
	id: string,
	kind: string,
	rest: string[],
): { def: SymbolDef; nets: Record<string, string>; value: string } | string {
	if (kind === "ic") {
		const pins = icPins(rest);
		if (pins.errors.length) {
			return `${id}: ${pins.errors.join("; ")}`;
		}
		return { def: ic(pins.sides, [id, pins.type]), nets: pins.nets, value: pins.type };
	}
	const known = KINDS[kind];
	if (!known) {
		return `${kind} is not a part (${Object.keys(KINDS).join(", ")}, ic)`;
	}
	const nodes = rest.slice(0, known.nodes.length);
	if (nodes.length < known.nodes.length) {
		return `${id} is a ${kind}: write its ${known.nodes.length} nodes (${known.nodes.join(", ")}) after the name`;
	}
	const nets = Object.fromEntries(known.nodes.map((pin, i) => [pin, nodes[i] ?? ""]));
	return { def: known.def, nets, value: rest.slice(known.nodes.length).join(" ") };
}

const labelOf = (kind: string, id: string, value: string) =>
	["port", "vdd", "vss"].includes(kind) ? [value || id] : value ? [id, value] : [id];

/** One part line as a part, or what is wrong with it. */
function partOf(text: string, line: number): NetPart | string {
	const [id = "", ...after] = words(text);
	if (/[.@]/.test(id)) {
		return `${id}: a part's name has no . or @, which write pins and places`;
	}
	const explicit = after[0] && KEYWORDS.has(after[0]) ? after.shift() : undefined;
	const kind = explicit ?? LETTERS[id[0]?.toUpperCase() ?? ""];
	if (!kind) {
		return `${id}: name a part by its SPICE letter (R, C, L, D, V, I, Q, M, U) or write its kind after the name (${[...KEYWORDS].join(", ")})`;
	}
	const { placement, o, rest } = splitPlacement(after, kind !== "ic");
	const wiring = wiringOf(id, kind, rest);
	if (typeof wiring === "string") {
		return wiring;
	}
	return {
		id,
		kind,
		def: wiring.def,
		at: { x: 0, y: 0 },
		o,
		label: labelOf(kind, id, wiring.value),
		nets: wiring.nets,
		line,
		placement,
	};
}

/** A block's netlist: its optional `title` line (the figure's name for screen readers) and one part per line; # starts a comment. */
export function parseNetlist(source: string): {
	title: string;
	parts: NetPart[];
	errors: string[];
} {
	const parts: NetPart[] = [];
	const errors: string[] = [];
	let title = "Schematic";
	source.split("\n").forEach((raw, i) => {
		const text = raw.replace(/#.*$/, "").trim();
		const line = i + 1;
		if (!text) {
			return;
		}
		if (/^title\s/i.test(text)) {
			title = text.replace(/^title\s+/i, "");
			return;
		}
		const part = partOf(text, line);
		if (typeof part === "string") {
			errors.push(`line ${line}: ${part}`);
		} else if (parts.some((p) => p.id === part.id)) {
			errors.push(
				`line ${line}: ${part.id} is already a part (line ${parts.find((p) => p.id === part.id)?.line}); give this one another name`,
			);
		} else {
			parts.push(part);
		}
	});
	return { title, parts, errors };
}
