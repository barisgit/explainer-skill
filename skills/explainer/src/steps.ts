import { writeFileSync } from "node:fs";
import type { Cdp } from "./cdp.ts";
import { ELEMENT_NAME_JS, REGION_VISIBLE_JS, SETTLE_JS } from "./page-js.ts";

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
	Backspace: [8, "Backspace"],
};
/** The `--do` step kinds, each written `<kind>:<arg>`; `reload` is the one step without an argument. */
const KINDS = ["click", "key", "hover", "focus", "type", "set", "shot"] as const;
type StepKind = (typeof KINDS)[number];
/** Dot-all, so the text of a type: step may span lines. */
const STEP = new RegExp(`^(${KINDS.join("|")}):(.+)$`, "s");
const POINT = /^(\d+),(\d+)$/;
const NTH = /@(all|\d+)$/;
const RELOAD = "reload";
/** The steps that write a value into a field, with the form their help shows. */
const VALUE_FORMS = { type: "type:<css>=<text>", set: "set:<css>=<value>" } as const;
/** The steps that act on an element and cannot take a point. */
const SELECTOR_ONLY = new Set<StepKind>(["focus", "type", "set", "shot"]);
/** Input types that take typed text; the others (range, date, color, checkbox) are set: or click: territory. */
const TEXT_TYPES = ["text", "search", "email", "url", "tel", "password", "number"];

/** A parsed step: `arg` is the selector, point or key; `value` is what type: and set: write (undefined when the step has no `=`). */
interface ParsedStep {
	kind: StepKind;
	arg: string;
	value?: string | undefined;
}

/** How each bracket changes the attribute-selector depth while valueStart scans. */
const BRACKET_DEPTH: Record<string, number> = { "[": 1, "]": -1 };
/** The tokens valueStart scans: a backslash escape, a whole quoted string (unclosed runs to the end), or one character. */
const SELECTOR_TOKEN = /\\.|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|./gs;

/**
 * Where the value of `<css>=<value>` starts: after the first `=` outside `[...]` and quoted strings, with a backslash escaping the
 * next character as in CSS. So `input[name=q]=a=b` is `input[name=q]` and `a=b`, and `[data-label="a]=b"]=new` keeps its quoted
 * `]=` in the selector. -1 when there is no such `=`.
 */
function valueStart(arg: string): number {
	let depth = 0;
	for (const { 0: token, index } of arg.matchAll(SELECTOR_TOKEN)) {
		if (token === "=" && depth === 0) {
			return index + 1;
		}
		depth += BRACKET_DEPTH[token] ?? 0;
	}
	return -1;
}

function parseStep(step: string): ParsedStep | undefined {
	const [, kind, arg] = STEP.exec(step) ?? [];
	if (!kind || !arg) {
		return undefined;
	}
	const start = kind in VALUE_FORMS ? valueStart(arg) : -1;
	return start < 0
		? { kind: kind as StepKind, arg }
		: { kind: kind as StepKind, arg: arg.slice(0, start - 1), value: arg.slice(start) };
}

/** Returns why a `--do` step is malformed, or "" when it parses. */
export function stepError(step: string): string {
	if (step === RELOAD) {
		return "";
	}
	const parsed = parseStep(step);
	if (!parsed) {
		return `step "${step}" must be click:<css>[@all|@index], click:<x,y>, hover:<css | x,y>, focus:<css>, key:<Key>, ${VALUE_FORMS.type}, ${VALUE_FORMS.set}, shot:<css>[@all|@index] or reload`;
	}
	const { kind, arg, value } = parsed;
	if ((kind === "type" || kind === "set") && (value === undefined || !arg)) {
		return `step "${step}" needs a selector and a value: ${VALUE_FORMS[kind]}, e.g. ${kind}:#year=2030`;
	}
	if (SELECTOR_ONLY.has(kind) && POINT.test(arg)) {
		return `step "${step}": ${kind} takes a CSS selector, not a point; click:<x,y> presses at a point and focuses what it hits`;
	}
	if (kind === "key" && arg.length > 1 && !KEYS[arg]) {
		return `unknown key "${arg}" (use ${Object.keys(KEYS).join(", ")} or one character)`;
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

/** Like onNth, but returns what `body` returns (null when the match is gone); a page exception is thrown here. */
const valueOnNth = <T>(cdp: Cdp, selector: string, index: number, body: string) =>
	cdp.evaluate<T | null>(
		`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; ${body} })()`,
	);

/**
 * What a step reported: a `problem` fails the check, a `note` just says what happened (how many elements an `@all` click hit,
 * matches a shot: could not capture), `pngs` are the files a shot: step wrote.
 */
export interface StepResult {
	problem?: string;
	note?: string;
	pngs?: string[];
}

/**
 * The file a shot: step writes for one match: `selector` is the one the step queries (without `@all` or `@<n>`, attribute values
 * quoted), and `index` the match's 0-based position when the step names `@all` or `@<n>`, else undefined.
 */
export type ShotPath = (selector: string, index: number | undefined) => string;

/**
 * The key code and DOM code of a letter or digit, whose code point is its own key code. Other characters get none: their code
 * point is another key's ("." is 46, Delete; "(" is 40, ArrowDown), which Chrome would act on instead of typing them.
 */
function characterCodes(character: string): { windowsVirtualKeyCode?: number; code?: string } {
	const upper = character.toUpperCase();
	if (/^[A-Z]$/.test(upper)) {
		return { windowsVirtualKeyCode: upper.charCodeAt(0), code: `Key${upper}` };
	}
	return /^\d$/.test(character)
		? { windowsVirtualKeyCode: character.charCodeAt(0), code: `Digit${character}` }
		: {};
}

/** Types one character as a key press that carries its text. */
async function typeCharacter(cdp: Cdp, character: string) {
	const codes = characterCodes(character);
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: character,
		text: character,
		...codes,
	});
	await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: character, ...codes });
}

/** Presses a named key (KEYS) or types one character. */
async function keyStep(cdp: Cdp, name: string): Promise<StepResult> {
	const named = KEYS[name];
	if (!named) {
		await typeCharacter(cdp, name);
		return {};
	}
	const [vk, code] = named;
	const key = name === "Space" ? " " : name;
	let text: string | undefined;
	if (name === "Space") {
		text = " ";
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

/** Finds what a step other than key: acts on, or why nothing can be: invalid selector, no match, index out of range. */
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
async function domClick(cdp: Cdp, step: string, target: Target): Promise<StepResult> {
	for (const i of target.indices) {
		await onNth(
			cdp,
			target.selector,
			i,
			"el.scrollIntoView({ block: 'center' }); el.focus?.({ preventScroll: true }); el.click()",
		);
		if (target.indices.length > 1) {
			// What a click still misses shows in the settle after the step.
			await settlePage(cdp);
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
 * Page-side body (with `el`): focuses a text field and selects its text, so typing replaces it. Returns why the reader could not type
 * there (not a text field, disabled, read-only, or focus did not land on it, so keys would reach whatever had it before), else "".
 */
const TYPE_READY_JS = `
	const name = (${ELEMENT_NAME_JS})(el);
	const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ${JSON.stringify(TEXT_TYPES)}.includes(el.type));
	if (!field && !el.isContentEditable) return name + (el instanceof HTMLInputElement ? "[type=" + el.type + "]" : "") + " is not a text field; ${VALUE_FORMS.set} sets ranges, selects and dates";
	if (field && el.disabled) return name + " is disabled, so a reader cannot type in it";
	if (field && el.readOnly) return name + " is read-only, so a reader cannot type in it";
	el.scrollIntoView({ block: "center" });
	el.focus();
	if (document.activeElement !== el) return name + " did not take focus (hidden, inert or behind a modal dialog), so nothing was typed";
	if (el.isContentEditable) getSelection().selectAllChildren(el); else el.select();
	return "";`;

/**
 * Types over a text field as a reader would: select its text, press a key per character (Enter for a newline, Backspace for no
 * text), then leave it so change fires.
 */
async function typeStep(cdp: Cdp, step: string, target: Target, text: string): Promise<StepResult> {
	for (const i of target.indices) {
		const problem = await valueOnNth<string>(cdp, target.selector, i, TYPE_READY_JS);
		if (problem) {
			return { problem: `${step}: ${problem}` };
		}
		if (text) {
			for (const character of text) {
				await (character === "\n" ? keyStep(cdp, "Enter") : typeCharacter(cdp, character));
			}
		} else {
			await keyStep(cdp, "Backspace");
		}
		await onNth(cdp, target.selector, i, "el.blur()");
	}
	return {};
}

/**
 * Page-side body (with `el` and `value`): sets a field's value through its prototype's setter, so frameworks that track the value
 * (React, Preact) see the change, then fires input and change as a reader's pick does. Returns why the value did not take, or "".
 */
const SET_JS = `
	if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return "a " + el.type + " is ticked with click:";
	const proto = [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement].find((kind) => el instanceof kind)?.prototype;
	if (!proto) return el.tagName.toLowerCase() + " is not an input, select or textarea";
	const options = el instanceof HTMLSelectElement ? [...el.options].map((o) => o.value) : [];
	if (options.length && !options.includes(value)) return "no option has the value " + JSON.stringify(value) + " (" + options.join(", ") + ")";
	el.scrollIntoView({ block: "center" });
	el.focus({ preventScroll: true });
	Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
	el.dispatchEvent(new Event("change", { bubbles: true }));
	const same = el.value === value || (el.value !== "" && Number(el.value) === Number(value));
	return same ? "" : "the field holds " + JSON.stringify(el.value) + ", not " + JSON.stringify(value);`;

/** Sets a range, select, date or any other field's value directly and fires input then change. */
async function setStep(cdp: Cdp, step: string, target: Target, value: string): Promise<StepResult> {
	for (const i of target.indices) {
		const problem = await valueOnNth<string>(
			cdp,
			target.selector,
			i,
			`const value = ${JSON.stringify(value)};${SET_JS}`,
		);
		if (problem) {
			return { problem: `${step}: ${problem}` };
		}
	}
	return {};
}

/** An element's box in document coordinates, and whether it lies wholly in the viewport. */
interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
	inView: boolean;
}

/** Page-side expression (with `el`): true when the element has a box of some size and its region shows something (REGION_VISIBLE_JS). */
const HAS_BOX_JS = `((r) => r.width > 0 && r.height > 0)(el.getBoundingClientRect()) && (${REGION_VISIBLE_JS})(el)`;
/** Page-side expression (with `el`): true when the element lies wholly in the viewport. */
const IN_VIEW_JS = `((r) => r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth)(el.getBoundingClientRect())`;

/**
 * Page-side body (with `el`): "hidden" when the reader cannot see the element, "scrolled" when it was not wholly in view and has been
 * scrolled to (centred if it fits the viewport, else its top), "" when it is in view already and is left where it is, so a hover
 * tooltip stays.
 */
const BRING_INTO_VIEW_JS = `
	if (!(${HAS_BOX_JS})) return "hidden";
	if (${IN_VIEW_JS}) return "";
	const r = el.getBoundingClientRect();
	el.scrollIntoView({ block: r.height <= innerHeight && r.width <= innerWidth ? "center" : "start" });
	return "scrolled";`;

/** Page-side body (with `el`): the element's box now (null when it is no longer shown). */
const BOX_JS = `
	if (!(${HAS_BOX_JS})) return null;
	const r = el.getBoundingClientRect();
	return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, inView: ${IN_VIEW_JS} };`;

/**
 * The box of the `index`-th match once it is in view and what scrolling to it set off (scroll handlers, observers that load or
 * resize content) has settled, so the geometry is the one the capture sees; null when the reader cannot see the match.
 */
async function settledBox(cdp: Cdp, target: Target, index: number): Promise<Box | null> {
	const brought = await valueOnNth<string>(cdp, target.selector, index, BRING_INTO_VIEW_JS);
	if (brought === "hidden" || brought === null) {
		return null;
	}
	if (brought === "scrolled") {
		await settlePage(cdp);
	}
	return valueOnNth<Box>(cdp, target.selector, index, BOX_JS);
}

/**
 * Saves a PNG of each targeted element's box as the page is now. One wholly in the viewport is captured from the screen as it is;
 * any other beyond the viewport, which relays the page out as the full-page shots do. Matches the reader cannot see are a note.
 */
async function shotStep(
	cdp: Cdp,
	step: string,
	target: Target,
	shotPath: ShotPath,
): Promise<StepResult> {
	const pngs: string[] = [];
	const hidden: number[] = [];
	for (const i of target.indices) {
		const box = await settledBox(cdp, target, i);
		if (!box) {
			hidden.push(i);
			continue;
		}
		const { x, y, width, height, inView } = box;
		const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: !inView,
			clip: { x, y, width, height, scale: 1 },
		});
		const png = shotPath(target.selector, target.nth === undefined ? undefined : i);
		writeFileSync(png, Buffer.from(data, "base64"));
		pngs.push(png);
	}
	if (!hidden.length) {
		return { pngs };
	}
	const width = await cdp.evaluate<number>("innerWidth");
	const which = target.nth === undefined ? "its match" : `match ${hidden.join(", ")}`;
	return { pngs, note: `${step}: no PNG at ${width} px wide: ${which} is not shown` };
}

/**
 * Waits until the page has drawn what its load or the last action started (SETTLE_JS: frames, fonts, visible charts, the short
 * timers check tracks); returns "" or what is still missing at the deadline.
 */
export const settlePage = (cdp: Cdp) => cdp.evaluate<string>(SETTLE_JS, true);

/**
 * Runs one step in the page, then waits until the page has settled (settlePage); a step after which something is still missing
 * reports it as its problem. Selectors may end in `@all` (every match, re-queried before each click, the page settling after
 * each so handlers that rebuild the DOM finish) or `@<index>` (0-based); without it the first match is used. A shot: step writes
 * to `shotPath`. `reload` reloads the page as the reader would (same URL, same storage).
 */
export async function runStep(cdp: Cdp, step: string, shotPath: ShotPath): Promise<StepResult> {
	let result: StepResult = {};
	if (step === RELOAD) {
		await cdp.load();
	} else {
		result = await act(cdp, step, shotPath);
	}
	const missing = await settlePage(cdp);
	return missing && !result.problem ? { ...result, problem: `${step}: ${missing}` } : result;
}

/** Runs one step other than reload, without waiting for the page afterwards. */
async function act(cdp: Cdp, step: string, shotPath: ShotPath): Promise<StepResult> {
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
	switch (parsed.kind) {
		case "type":
			return typeStep(cdp, step, target, parsed.value ?? "");
		case "set":
			return setStep(cdp, step, target, parsed.value ?? "");
		case "shot":
			return shotStep(cdp, step, target, shotPath);
		case "focus":
			await onNth(cdp, target.selector, target.indices[0] ?? 0, "el.focus()");
			return {};
		default:
			return parsed.kind === "click" && !target.isPoint
				? domClick(cdp, step, target)
				: mouseStep(cdp, step, parsed.kind, target);
	}
}
