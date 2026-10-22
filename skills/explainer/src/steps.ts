import type { Cdp } from "./chrome.ts";

/** Key name to [virtual key code, DOM code] for Input.dispatchKeyEvent; a single character types itself. */
const KEYS: Record<string, [number, string]> = {
	ArrowLeft: [37, "ArrowLeft"],
	ArrowUp: [38, "ArrowUp"],
	ArrowRight: [39, "ArrowRight"],
	ArrowDown: [40, "ArrowDown"],
	Enter: [13, "Enter"],
	Space: [32, "Space"],
	Escape: [27, "Escape"],
	Tab: [9, "Tab"],
	Home: [36, "Home"],
	End: [35, "End"],
};
const STEP = /^(click|key|hover|focus):(.+)$/;
const POINT = /^(\d+),(\d+)$/;
const NTH = /@(all|\d+)$/;
const SETTLE_MS = 150;

type StepKind = "click" | "key" | "hover" | "focus";
interface ParsedStep {
	kind: StepKind;
	arg: string;
}

function parseStep(step: string): ParsedStep | undefined {
	const [, kind, arg] = STEP.exec(step) ?? [];
	return kind && arg ? { kind: kind as StepKind, arg } : undefined;
}

/** Returns why a `--do` step is malformed, or "" when it parses. */
export function stepError(step: string): string {
	const parsed = parseStep(step);
	if (!parsed) {
		return `step "${step}" must be click:<css>[@all|@index], click:<x,y>, key:<Key>, focus:<css> or hover:<css | x,y>`;
	}
	if (parsed.kind === "key" && parsed.arg.length > 1 && !KEYS[parsed.arg]) {
		return `unknown key "${parsed.arg}" (use ${Object.keys(KEYS).join(", ")} or one character)`;
	}
	return "";
}

/** Unquoted attribute values are not valid CSS when they start with a digit: `[value=0]` becomes `[value="0"]`. */
const quoteAttrValues = (css: string) =>
	css.replace(/\[\s*([\w:-]+)\s*([~|^$*]?=)\s*([^\]"'\s][^\]"']*?)\s*\]/g, '[$1$2"$3"]');

type Found = { count: number } | { error: string };

/** Runs in the page: how many elements match, or why the selector is invalid. */
function countMatches(cdp: Cdp, selector: string): Promise<Found> {
	return cdp.evaluate<Found>(
		`(() => { try { return { count: document.querySelectorAll(${JSON.stringify(selector)}).length }; } catch (e) { return { error: String(e.message) }; } })()`,
	);
}

interface Point {
	x: number;
	y: number;
}

/** Page coordinates of a hover/click target: literal `x,y`, or the centre of the `index`-th matching element scrolled into view (null if none). */
async function pointOf(cdp: Cdp, arg: string, index: number): Promise<Point | null> {
	const xy = POINT.exec(arg);
	if (xy) {
		return { x: Number(xy[1]), y: Number(xy[2]) };
	}
	return cdp.evaluate<Point | null>(
		`(() => { const el = document.querySelectorAll(${JSON.stringify(arg)})[${index}]; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
	);
}

/** Runs the same expression on the `index`-th match, so every click of an `@all` sequence sees the DOM the previous click left behind. */
const onNth = (cdp: Cdp, selector: string, index: number, body: string) =>
	cdp.send("Runtime.evaluate", {
		expression: `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return false; ${body}; return true; })()`,
		returnByValue: true,
	});

/** What a step reported: a `problem` fails the check, a `note` just says what happened (how many elements an `@all` click hit). */
export interface StepResult {
	problem?: string;
	note?: string;
}

async function keyStep(cdp: Cdp, name: string): Promise<StepResult> {
	const upper = name.toUpperCase();
	const [vk, code] = KEYS[name] ?? [upper.charCodeAt(0), `Key${upper}`];
	const key = name === "Space" ? " " : name;
	let text: string | undefined;
	if (key.length === 1) {
		text = key;
	} else if (name === "Enter") {
		text = "\r";
	}
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code,
			windowsVirtualKeyCode: vk,
			text: type === "keyDown" ? text : undefined,
		});
	}
	return {};
}

/** The element(s) a step acts on: a literal point, or a selector with the indices of the matches to use. */
interface Target {
	selector: string;
	indices: number[];
	nth: string | undefined;
	isPoint: boolean;
}

/** Finds what a click/hover/focus step acts on, or why nothing can be: invalid selector, no match, index out of range. */
async function resolveTarget(
	cdp: Cdp,
	step: string,
	arg: string,
): Promise<{ target: Target } | { problem: string }> {
	if (POINT.test(arg)) {
		return { target: { selector: arg, indices: [0], nth: undefined, isPoint: true } };
	}
	const nth = NTH.exec(arg)?.[1];
	const selector = quoteAttrValues(arg.replace(NTH, ""));
	const found = await countMatches(cdp, selector);
	if ("error" in found) {
		return {
			problem: `${step}: invalid CSS selector (${found.error}). Quote attribute values: [value="0"]`,
		};
	}
	const indices =
		nth === "all" ? Array.from({ length: found.count }, (_, i) => i) : [Number(nth ?? 0)];
	if (!found.count || indices.some((i) => i >= found.count)) {
		return {
			problem: `${step}: ${found.count ? `only ${found.count} element(s) match` : "no element matches"} ${selector}`,
		};
	}
	return { target: { selector, indices, nth, isPoint: false } };
}

/** DOM click: the handler runs whatever overlaps the element, and the element is focused first so key: steps reach it. */
async function domClick(
	cdp: Cdp,
	step: string,
	target: Target,
	settle: (ms: number) => Promise<unknown>,
): Promise<StepResult> {
	for (const i of target.indices) {
		await onNth(
			cdp,
			target.selector,
			i,
			"el.scrollIntoView({ block: 'center' }); el.focus?.({ preventScroll: true }); el.click()",
		);
		if (target.indices.length > 1) {
			await settle(SETTLE_MS);
		}
	}
	return target.nth === "all" ? { note: `${step}: clicked ${target.indices.length}` } : {};
}

/** Real mouse events, so :hover styles and pointer handlers (chart tips, marks) fire; click:x,y presses and releases there. */
async function mouseStep(
	cdp: Cdp,
	step: string,
	kind: StepKind,
	target: Target,
): Promise<StepResult> {
	const point = await pointOf(cdp, target.selector, target.indices[0] ?? 0);
	if (!point) {
		return { problem: `${step}: no element matches ${target.selector}` };
	}
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	if (kind === "click") {
		for (const type of ["mousePressed", "mouseReleased"]) {
			await cdp.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
		}
	}
	return {};
}

/**
 * Runs one step in the page. Selectors may end in `@all` (every match, re-queried before each click, with a pause after each so handlers
 * that rebuild the DOM finish) or `@<index>` (0-based); without it the first match is used.
 */
export async function runStep(
	cdp: Cdp,
	step: string,
	settle: (ms: number) => Promise<unknown>,
): Promise<StepResult> {
	const parsed = parseStep(step);
	if (!parsed) {
		return { problem: stepError(step) };
	}
	if (parsed.kind === "key") {
		return keyStep(cdp, parsed.arg);
	}
	const resolved = await resolveTarget(cdp, step, parsed.arg);
	if ("problem" in resolved) {
		return resolved;
	}
	const { target } = resolved;
	if (parsed.kind === "focus") {
		await onNth(cdp, target.selector, target.indices[0] ?? 0, "el.focus()");
		return {};
	}
	if (parsed.kind === "click" && !target.isPoint) {
		return domClick(cdp, step, target, settle);
	}
	return mouseStep(cdp, step, parsed.kind, target);
}
