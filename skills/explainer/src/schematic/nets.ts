/** The nets of a netlist as the drawing needs them: which pins each joins, where ground symbols go, what is left open on purpose. */
import { add, type Point, UPRIGHT } from "./geometry.ts";
import { exitOf, type Part, pinAt, type Wire } from "./scene.ts";
import { G, GROUND_SYMBOLS, type SymbolDef } from "./symbols.ts";

/** The net name for a pin left open on purpose. */
export const OPEN_NET = "nc";

/** A ground net's canonical name (also its data-ref) and the symbol used instead of wiring its pins together. */
export function groundOf(net: string): { ref: string; def: SymbolDef } | undefined {
	const ref = net === "0" || net === "GND" ? "gnd" : net;
	const def = GROUND_SYMBOLS.get(ref);
	return def && { ref, def };
}

/** The pins each net joins, in the order the netlist lists them; ground and open nets are not wired, so they are left out. */
export function netsOf(parts: Part[]): Map<string, Array<{ part: Part; pin: string }>> {
	const nets = new Map<string, Array<{ part: Part; pin: string }>>();
	for (const part of parts) {
		for (const [pin, net] of Object.entries(part.nets)) {
			if (!(groundOf(net) || net === OPEN_NET)) {
				nets.set(net, [...(nets.get(net) ?? []), { part, pin }]);
			}
		}
	}
	return nets;
}

/** The ground symbol for one pin and the stub wire to it (none when it sits right under the pin), or what is wrong. */
function groundFor(
	part: Part,
	pin: string,
	p: Point,
	symbol: { ref: string; def: SymbolDef },
): { ground: Part; wire?: Wire } | string {
	const exit = exitOf(part, pin);
	if (exit.y < 0) {
		return `line ${part.line} (${part.id}): pin ${pin} is on ground but faces up, where a ground symbol would hang upside down; turn ${part.id} so that pin faces down (a two-terminal: v has a on top and b below, r270 has a below) or put it on the bottom side of an IC`;
	}
	const at = exit.y > 0 ? p : add(p, { x: exit.x * G, y: 0 });
	const ground: Part = {
		id: symbol.ref,
		kind: "ground",
		def: symbol.def,
		at,
		o: UPRIGHT,
		label: [],
		nets: { a: symbol.ref },
		line: part.line,
	};
	return at === p ? { ground } : { ground, wire: { net: symbol.ref, points: [p, at] } };
}

/**
 * A ground symbol at every ground pin, right under a pin that leaves downwards, else at the end of a 10-unit sideways stub
 * on the same net. A pin that leaves upwards cannot reach a downward symbol without running back past its own part.
 */
export function groundsFor(parts: Part[]): { grounds: Part[]; wires: Wire[]; errors: string[] } {
	const made = parts.flatMap((part) =>
		Object.entries(part.nets).flatMap(([pin, net]) => {
			const p = pinAt(part, pin);
			const symbol = groundOf(net);
			return p && symbol ? [groundFor(part, pin, p, symbol)] : [];
		}),
	);
	return {
		grounds: made.flatMap((m) => (typeof m === "string" ? [] : [m.ground])),
		wires: made.flatMap((m) => (typeof m === "string" || !m.wire ? [] : [m.wire])),
		errors: made.filter((m) => typeof m === "string"),
	};
}
