/** The nets of a netlist as the drawing needs them: which pins each joins, where ground symbols go, what is left open on purpose. */
import { add, type Point, UPRIGHT } from "./geometry.ts";
import { exitOf, type Part, pinAt, type Wire } from "./scene.ts";
import { G, GROUND } from "./symbols.ts";

/** Net names that mean ground; each pin on one gets a ground symbol of its own instead of a wire to the rest. */
export const GROUND_NETS = new Set(["0", "gnd", "GND"]);

/** The net name for a pin left open on purpose. */
export const OPEN_NET = "nc";

/** The data-ref every ground symbol and ground wire carries, so prose can light them all. */
export const GROUND_REF = "gnd";

/** The pins each net joins, in the order the netlist lists them; ground and open nets are not wired, so they are left out. */
export function netsOf(parts: Part[]): Map<string, Array<{ part: Part; pin: string }>> {
	const nets = new Map<string, Array<{ part: Part; pin: string }>>();
	for (const part of parts) {
		for (const [pin, net] of Object.entries(part.nets)) {
			if (!(GROUND_NETS.has(net) || net === OPEN_NET)) {
				nets.set(net, [...(nets.get(net) ?? []), { part, pin }]);
			}
		}
	}
	return nets;
}

/** The ground symbol for one pin and the stub wire to it (none when it sits right under the pin), or what is wrong. */
function groundFor(part: Part, pin: string, p: Point): { ground: Part; wire?: Wire } | string {
	const exit = exitOf(part, pin);
	if (exit.y < 0) {
		return `line ${part.line} (${part.id}): pin ${pin} is on ground but faces up, where a ground symbol would hang upside down; turn ${part.id} so that pin faces down (a two-terminal: v has a on top and b below, r270 has a below) or put it on the bottom side of an IC`;
	}
	const at = exit.y > 0 ? p : add(p, { x: exit.x * G, y: 0 });
	const ground: Part = {
		id: GROUND_REF,
		kind: "ground",
		def: GROUND,
		at,
		o: UPRIGHT,
		label: [],
		nets: { a: GROUND_REF },
		line: part.line,
	};
	return at === p ? { ground } : { ground, wire: { net: GROUND_REF, points: [p, at] } };
}

/**
 * A ground symbol at every pin on net 0, always hanging down: right under a pin that leaves downwards, else at the end of a
 * 10-unit stub sideways (a wire of net `gnd`, which the check keeps clear of the other nets like any other wire). A pin that
 * leaves upwards cannot reach a ground that hangs down without running back past its own part, so it is an error that says
 * to turn the part.
 */
export function groundsFor(parts: Part[]): { grounds: Part[]; wires: Wire[]; errors: string[] } {
	const made = parts.flatMap((part) =>
		Object.entries(part.nets).flatMap(([pin, net]) => {
			const p = pinAt(part, pin);
			return p && GROUND_NETS.has(net) ? [groundFor(part, pin, p)] : [];
		}),
	);
	return {
		grounds: made.flatMap((m) => (typeof m === "string" ? [] : [m.ground])),
		wires: made.flatMap((m) => (typeof m === "string" || !m.wire ? [] : [m.wire])),
		errors: made.filter((m) => typeof m === "string"),
	};
}
