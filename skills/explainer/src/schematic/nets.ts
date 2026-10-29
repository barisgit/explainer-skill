/** The nets of a netlist as the drawing needs them: which pins each joins, where ground symbols go, what is left open on purpose. */
import { add, type Orientation, type Point, UPRIGHT } from "./geometry.ts";
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

/** The orientation of a ground symbol whose wire arrives from the direction a pin leaves in: it hangs away from its pin. */
function facing(exit: Point): Orientation {
	if (exit.y > 0) {
		return UPRIGHT;
	}
	return { rot: exit.y < 0 ? 180 : exit.x < 0 ? 90 : 270, flip: false };
}

/**
 * A ground symbol at every pin on net 0: right under a pin that leaves downwards, else at the end of a 10-unit stub, turned to hang away from the pin (a wire of
 * net 0, which the check keeps clear of the other nets like any other wire).
 */
export function groundsFor(parts: Part[]): { grounds: Part[]; wires: Wire[] } {
	const grounds: Part[] = [];
	const wires: Wire[] = [];
	for (const part of parts) {
		for (const [pin, net] of Object.entries(part.nets)) {
			const p = pinAt(part, pin);
			if (!p || !GROUND_NETS.has(net)) {
				continue;
			}
			const exit = exitOf(part, pin);
			const at = exit.y > 0 ? p : add(p, { x: exit.x * G, y: exit.y * G });
			if (at !== p) {
				wires.push({ net: GROUND_REF, points: [p, at] });
			}
			grounds.push({
				id: GROUND_REF,
				kind: "ground",
				def: GROUND,
				at,
				o: facing(exit),
				label: [],
				nets: { a: GROUND_REF },
				line: part.line,
			});
		}
	}
	return { grounds, wires };
}
