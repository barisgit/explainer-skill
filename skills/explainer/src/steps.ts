import { type Page, settle } from "./browser.ts";

/** The named keys a step accepts; any other key is a single character. */
const KEYS = [
	"ArrowLeft",
	"ArrowUp",
	"ArrowRight",
	"ArrowDown",
	"Enter",
	"Space",
	"Escape",
	"Tab",
	"Home",
	"End",
];
const STEP = /^(click|key|hover|focus):(.+)$/;
const POINT = /^(\d+),(\d+)$/;
const NTH = /@(all|\d+)$/;
const RELOAD = "reload";
const SETTLE_MS = 150;
const RELOAD_SETTLE_MS = 400;

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
	if (step === RELOAD) {
		return "";
	}
	const parsed = parseStep(step);
	if (!parsed) {
		return `step "${step}" must be click:<css>[@all|@index], click:<x,y>, key:<Key>, focus:<css>, hover:<css | x,y> or reload`;
	}
	if (parsed.kind === "focus" && POINT.test(parsed.arg)) {
		return `step "${step}": focus takes a CSS selector, not a point; click:<x,y> presses at a point and focuses what it hits`;
	}
	if (parsed.kind === "key" && parsed.arg.length > 1 && !KEYS.includes(parsed.arg)) {
		return `unknown key "${parsed.arg}" (use ${KEYS.join(", ")} or one character)`;
	}
	return "";
}

/** Unquoted attribute values are not valid CSS when they start with a digit: `[value=0]` becomes `[value="0"]`. */
const quoteAttrValues = (css: string) =>
	css.replace(/\[\s*([\w:-]+)\s*([~|^$*]?=)\s*([^\]"'\s][^\]"']*?)\s*\]/g, '[$1$2"$3"]');

type Found = { count: number } | { error: string };

/** Runs in the page: how many elements match, or why the selector is invalid. */
function countMatches(page: Page, selector: string): Promise<Found> {
	return page.evaluate<Found>(
		`(() => { try { return { count: document.querySelectorAll(${JSON.stringify(selector)}).length }; } catch (e) { return { error: String(e.message) }; } })()`,
	);
}

interface Point {
	x: number;
	y: number;
}

/** Page coordinates of a hover/click target: literal `x,y`, or the centre of the `index`-th matching element scrolled into view (null if none). */
async function pointOf(page: Page, arg: string, index: number): Promise<Point | null> {
	const xy = POINT.exec(arg);
	if (xy) {
		return { x: Number(xy[1]), y: Number(xy[2]) };
	}
	return page.evaluate<Point | null>(
		`(() => { const el = document.querySelectorAll(${JSON.stringify(arg)})[${index}]; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
	);
}

/** Runs the same expression on the `index`-th match, so every click of an `@all` sequence sees the DOM the previous click left behind. */
const onNth = (page: Page, selector: string, index: number, body: string) =>
	page.evaluate<boolean>(
		`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return false; ${body}; return true; })()`,
	);

/** What a step reported: a `problem` fails the check, a `note` just says what happened (how many elements an `@all` click hit). */
export interface StepResult {
	problem?: string;
	note?: string;
}

/**
 * Page-side function: the key as the page sees it when WKWebView's `press` does not deliver one. WebKit turns arrows, Enter, Tab, Home and End
 * into editing commands, so no `keydown` reaches the page. The events are synthesised on the focused element, and the default action
 * of the few keys a page relies on is done by hand: Enter or Space presses a button or link, arrows move a range, Tab moves focus.
 */
const SYNTH_KEY_JS = (key: string) => `(() => {
	const key = ${JSON.stringify(key)};
	const el = document.activeElement ?? document.body;
	const init = { key, code: key, bubbles: true, cancelable: true };
	const free = el.dispatchEvent(new KeyboardEvent("keydown", init));
	if (free) {
		const range = el instanceof HTMLInputElement && el.type === "range";
		const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[key];
		if (key === "Enter" && el.matches("button, a[href], summary, input[type=checkbox], input[type=radio]")) el.click();
		else if (range && step) { step > 0 ? el.stepUp() : el.stepDown(); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
		else if (range && (key === "Home" || key === "End")) { el.value = key === "Home" ? el.min : el.max; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
		else if (key === "Tab") {
			const order = [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length);
			order[(order.indexOf(el) + 1) % order.length]?.focus();
		}
	}
	el.dispatchEvent(new KeyboardEvent("keyup", init));
})()`;

/** Keys WKWebView's `press` delivers as `keydown` (the rest become editing commands). */
const WEBKIT_KEYDOWN = new Set(["Space", "Escape"]);

async function keyStep(page: Page, name: string): Promise<StepResult> {
	if (page.backend === "webkit" && name.length > 1 && !WEBKIT_KEYDOWN.has(name)) {
		await page.evaluate(SYNTH_KEY_JS(name));
	} else {
		await page.view.press(name as Bun.WebView.VirtualKey);
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
	page: Page,
	step: string,
	arg: string,
): Promise<{ target: Target } | { problem: string }> {
	if (POINT.test(arg)) {
		return { target: { selector: arg, indices: [0], nth: undefined, isPoint: true } };
	}
	const nth = NTH.exec(arg)?.[1];
	const selector = quoteAttrValues(arg.replace(NTH, ""));
	const found = await countMatches(page, selector);
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
async function domClick(page: Page, step: string, target: Target): Promise<StepResult> {
	for (const i of target.indices) {
		await onNth(
			page,
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

/**
 * Page-side function: the pointer events of a mouse arriving at (x, y), for engines whose view cannot move the mouse without clicking.
 * Handlers (chart tooltips, marks) run; CSS `:hover` does not apply, as the browser applies it only to a real pointer.
 */
const SYNTH_HOVER_JS = ({ x, y }: Point) => `(() => {
	const el = document.elementFromPoint(${x}, ${y});
	if (!el) return;
	const init = { clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, view: window };
	for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
		const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
		el.dispatchEvent(new Event(type, init));
	}
})()`;

/** A click at a point is a real click; a hover is a real mouse move on Chrome (over `cdp`) and synthesised events on WebKit. */
async function mouseStep(
	page: Page,
	step: string,
	kind: StepKind,
	target: Target,
): Promise<StepResult> {
	const point = await pointOf(page, target.selector, target.indices[0] ?? 0);
	if (!point) {
		return { problem: `${step}: no element matches ${target.selector}` };
	}
	if (kind === "click") {
		await page.view.click(point.x, point.y);
	} else if (page.backend === "chrome") {
		await page.view.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	} else {
		await page.evaluate(SYNTH_HOVER_JS(point));
	}
	return {};
}

/** Reloads the page as the reader would (same URL, same storage) and waits for the load and for scripts to settle. */
async function reloadStep(page: Page): Promise<StepResult> {
	await page.reload();
	await settle(RELOAD_SETTLE_MS);
	return {};
}

/**
 * Runs one step in the page. Selectors may end in `@all` (every match, re-queried before each click, with a pause after each so handlers
 * that rebuild the DOM finish) or `@<index>` (0-based); without it the first match is used.
 */
export async function runStep(page: Page, step: string): Promise<StepResult> {
	if (step === RELOAD) {
		return reloadStep(page);
	}
	const parsed = parseStep(step);
	if (!parsed) {
		return { problem: stepError(step) };
	}
	if (parsed.kind === "key") {
		return keyStep(page, parsed.arg);
	}
	const resolved = await resolveTarget(page, step, parsed.arg);
	if ("problem" in resolved) {
		return resolved;
	}
	const { target } = resolved;
	if (parsed.kind === "focus") {
		await onNth(page, target.selector, target.indices[0] ?? 0, "el.focus()");
		return {};
	}
	if (parsed.kind === "click" && !target.isPoint) {
		return domClick(page, step, target);
	}
	return mouseStep(page, step, parsed.kind, target);
}
