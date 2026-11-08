import type { Cdp } from "./cdp.ts";

/** The one drag form: two current-viewport points, with the same unsigned-integer coordinates as click:x,y. */
export const DRAG_FORM = "drag:<x,y>-<x,y>";

interface Point {
	x: number;
	y: number;
}
interface Drag {
	from: Point;
	to: Point;
}

/** Parses only finite, safe integer points; selectors, offsets and @all are deliberately not another drag vocabulary. */
export function parseDrag(arg: string): Drag | undefined {
	const match = /^(\d+),(\d+)-(\d+),(\d+)$/.exec(arg);
	if (!match) {
		return undefined;
	}
	const [x, y, endX, endY] = match.slice(1).map(Number);
	if (
		x === undefined ||
		y === undefined ||
		endX === undefined ||
		endY === undefined ||
		![x, y, endX, endY].every(Number.isSafeInteger)
	) {
		return undefined;
	}
	return { from: { x, y }, to: { x: endX, y: endY } };
}

/** A bounded real left-button gesture; held moves reach canvas handlers and release runs even when dispatch fails. */
export async function dragStep(cdp: Cdp, { from, to }: Drag): Promise<void> {
	let point = from;
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	try {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...point,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		for (let i = 1; i <= 12; i++) {
			point = { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 };
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				...point,
				button: "left",
				buttons: 1,
			});
		}
	} finally {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...point,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	}
}
