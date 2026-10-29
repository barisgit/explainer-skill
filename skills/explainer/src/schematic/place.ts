/**
 * Placement: each part goes at a sheet position (`@x,y`) or has one of its pins put a fixed offset from a pin of another part
 * (`b@Q1.c 0,-1`), in any order the lines come in. The first part with no placement is at the origin.
 */
import { add, type Point } from "./geometry.ts";
import type { NetPart, Placement } from "./netlist.ts";
import { type Part, pinAt, pinNamed } from "./scene.ts";

const at = (part: Part) => `line ${part.line} (${part.id})`;

/** The pin names of a part, as the author is told them. */
const pinList = (part: Part) => Object.keys(part.def.pins).join(", ");

/**
 * Where a part goes once the part it is placed by is placed: its own pin (the origin when it names none) at the other part's
 * pin plus the offset.
 */
function resolve(
	part: NetPart,
	rel: NonNullable<Placement["relative"]>,
	other: NetPart,
): Point | string {
	const anchor = pinNamed(other, rel.anchor);
	if (!anchor) {
		return `${at(part)}: ${other.id} has no pin ${rel.anchor} (${pinList(other)})`;
	}
	const own = rel.pin === undefined ? undefined : pinNamed(part, rel.pin);
	if (rel.pin !== undefined && !own) {
		return `${at(part)}: ${part.id} has no pin ${rel.pin} (${pinList(part)})`;
	}
	const target = add(pinAt(other, anchor) ?? other.at, rel.offset);
	const local = own ? pinAt({ ...part, at: { x: 0, y: 0 } }, own) : undefined;
	return { x: target.x - (local?.x ?? 0), y: target.y - (local?.y ?? 0) };
}

/**
 * Places every part and returns what the author must fix. A part that is placed by a part placed later waits for it; parts
 * that wait on each other, or on a part that is never placed, are reported together.
 */
export function placeParts(parts: NetPart[]): string[] {
	const errors: string[] = [];
	const placed = new Set<string>();
	parts.forEach((part, i) => {
		const origin =
			part.placement.at ?? (i === 0 && !part.placement.relative ? { x: 0, y: 0 } : undefined);
		if (origin) {
			part.at = origin;
			placed.add(part.id);
		} else if (!part.placement.relative) {
			errors.push(
				`${at(part)}: say where it goes: ${part.id} pin@Part.pin dx,dy puts one of its pins dx,dy grid units from a pin of a part already drawn`,
			);
		}
	});
	let waiting = parts.filter((p) => !placed.has(p.id) && p.placement.relative);
	while (waiting.length) {
		const before = waiting.length;
		waiting = waiting.filter((part) => {
			const rel = part.placement.relative;
			const other = parts.find((p) => p.id === rel?.part);
			if (!(rel && other)) {
				errors.push(`${at(part)}: no part named ${rel?.part} to place it by`);
				return false;
			}
			if (!placed.has(other.id)) {
				return true;
			}
			const found = resolve(part, rel, other);
			if (typeof found === "string") {
				errors.push(found);
			} else {
				part.at = found;
				placed.add(part.id);
			}
			return false;
		});
		if (waiting.length === before) {
			errors.push(
				`${waiting.map(at).join(", ")}: placed by each other or by a part that is never placed; give one of them @x,y`,
			);
			break;
		}
	}
	return errors;
}
