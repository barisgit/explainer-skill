import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Cdp } from "./chrome.ts";
import { withPage } from "./chrome.ts";

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, narrow: { width: 390, height: 844 } } as const;
const THEMES = ["light", "dark"] as const;
/** The first viewport before any `--do` step: its PNG, the headline and the figures a reader sees without scrolling. */
export interface FirstScreen { png: string; headline: string; figures: string[] }
/**
 * `view` is the hash of a drill-down view ("" for the overview); `first` describes the first viewport, taken before any step (overview only).
 * `problems` fail the check; `warnings` are worth a look but do not (console warnings, sideways-scrolling containers, tiny diagram text,
 * a missing viewport meta, a diagram or chart taller than 1.5 viewports).
 */
export interface Shot { theme: string; viewport: string; view: string; png: string; first?: FirstScreen; problems: string[]; warnings: string[] }
/** `quick`: light theme only, no first-viewport shots, overview PNGs named desktop.png and narrow.png. `views` are --view values: hashes, "all" or "none". */
export interface CheckOptions { steps: string[]; views: string[]; tag: string; quick: boolean }
/** `found`: every drill-down hash the overview links to or declares; `uncaptured`: those not captured; `templates`: view names with a param that no link reaches. */
export interface ViewReport { found: string[]; captured: string[]; uncaptured: string[]; templates: string[] }
export interface CheckResult { shots: Shot[]; views: ViewReport; stepNotes: string[] }

const TINY_TEXT_PX = 9;
const TALL_FIGURE = 1.5;

/**
 * Runs in the page for the current viewport (`narrow`: the phone width). `culprits`: elements sticking out of the viewport that no scrolling
 * ancestor contains (only auto/scroll counts: hidden/clip would silently cut the content off). `scrolls`: containers whose content is wider
 * than their box and scrolls sideways. `warnings`: a missing viewport meta and SVG text rendered under 9 px (narrow only), diagrams and charts
 * (Mermaid, .chart, svg, canvas) taller than 1.5 viewports. Interactive panels (tables, matrices, players with a log) are tall by design and
 * are not measured. SVG text is measured at its on-screen size: font size times the svg's scale to the screen.
 */
const PAGE_JS = (narrow: boolean) => `(() => {
	const vw = document.documentElement.clientWidth;
	const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
	const scrolls = (el) => { const o = getComputedStyle(el).overflowX; return o === "auto" || o === "scroll"; };
	const clipped = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (scrolls(p)) return true; return false; };
	const shown = (el) => el.getClientRects().length > 0;
	const all = [...document.body.querySelectorAll("*")];
	const bad = all.filter((el) => el.getBoundingClientRect().right > vw + 1 && !clipped(el) && getComputedStyle(el).position !== "fixed");
	const inner = all.filter((el) => scrolls(el) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
	const warnings = [];
	if (${narrow} && !document.querySelector('meta[name="viewport"]')) warnings.push('no <meta name="viewport" content="width=device-width, initial-scale=1">: phones lay the page out at desktop width and shrink it');
	if (${narrow}) for (const svg of document.querySelectorAll("svg")) {
		if (!shown(svg)) continue;
		const scale = svg.getScreenCTM()?.a ?? 1;
		const tiny = [...svg.querySelectorAll("text, foreignObject *")]
			.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
			.map((el) => ({ px: parseFloat(getComputedStyle(el).fontSize) * scale, text: el.textContent.trim().slice(0, 24) }))
			.filter((t) => t.px < ${TINY_TEXT_PX}).sort((a, b) => a.px - b.px);
		if (tiny.length) warnings.push(name(svg.parentElement) + " svg: " + tiny.length + " text item(s) render under ${TINY_TEXT_PX} px at " + vw + " px wide (smallest " + tiny[0].px.toFixed(1) + " px, '" + tiny[0].text + "'): simplify the diagram, use top-down layout or fewer nodes");
	}
	const tall = [...document.querySelectorAll(".mermaid, .chart, svg, canvas")].filter((el) => shown(el) && el.getBoundingClientRect().height > innerHeight * ${TALL_FIGURE});
	for (const el of tall.filter((el) => !tall.some((o) => o !== el && o.contains(el)))) {
		const h = el.getBoundingClientRect().height;
		warnings.push(name(el) + " is " + Math.round(h) + " px tall, " + (h / innerHeight).toFixed(1) + " viewports (limit ${TALL_FIGURE}): shrink it, split it or move detail behind a click");
	}
	return {
		overflow: document.documentElement.scrollWidth > vw + 1, culprits: bad.slice(0, 4).map(name), warnings,
		scrolls: inner.slice(0, 6).map((el) => name(el) + " (content " + el.scrollWidth + "px in " + el.clientWidth + "px)"),
	};
})()`;

/** Runs in the page before any step: the headline and the figures at least partly in the first viewport (outermost only). */
const FIRST_SCREEN_JS = `(() => {
	const seen = (el) => { const r = el.getBoundingClientRect(); return r.width >= 120 && r.height >= 80 && Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= Math.min(200, r.height * 0.4); };
	const found = [...document.querySelectorAll("figure, .fig, .chart, .mermaid, .dg, svg, canvas, img")].filter(seen);
	const outer = found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
	const headline = document.querySelector("h1")?.textContent.replace(/\\s+/g, " ").trim() ?? "";
	return { headline: headline.length > 110 ? headline.slice(0, 107) + "..." : headline, figures: outer.map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")) };
})()`;

/** Key name to [virtual key code, DOM code] for Input.dispatchKeyEvent; a single character types itself. */
const KEYS: Record<string, [number, string]> = {
	ArrowLeft: [37, "ArrowLeft"], ArrowUp: [38, "ArrowUp"], ArrowRight: [39, "ArrowRight"], ArrowDown: [40, "ArrowDown"],
	Enter: [13, "Enter"], Space: [32, "Space"], Escape: [27, "Escape"], Tab: [9, "Tab"], Home: [36, "Home"], End: [35, "End"],
};
const STEP = /^(click|key|hover|focus):(.+)$/;
const POINT = /^(\d+),(\d+)$/;
const NTH = /@(all|\d+)$/;
const SETTLE_MS = 150;

/** Returns why a `--do` step is malformed, or "" when it parses. */
export function stepError(step: string): string {
	const m = STEP.exec(step);
	if (!m) return `step "${step}" must be click:<css>[@all|@index], click:<x,y>, key:<Key>, focus:<css> or hover:<css | x,y>`;
	if (m[1] === "key" && m[2]!.length > 1 && !KEYS[m[2]!]) return `unknown key "${m[2]}" (use ${Object.keys(KEYS).join(", ")} or one character)`;
	return "";
}

/** Unquoted attribute values are not valid CSS when they start with a digit: `[value=0]` becomes `[value="0"]`. */
const quoteAttrValues = (css: string) => css.replace(/\[\s*([\w:-]+)\s*([~|^$*]?=)\s*([^\]"'\s][^\]"']*?)\s*\]/g, '[$1$2"$3"]');

type Found = { count: number } | { error: string };

/** Runs in the page: how many elements match, or why the selector is invalid. */
async function countMatches(cdp: Cdp, selector: string): Promise<Found> {
	const r = await cdp.send("Runtime.evaluate", {
		expression: `(() => { try { return { count: document.querySelectorAll(${JSON.stringify(selector)}).length }; } catch (e) { return { error: String(e.message) }; } })()`,
		returnByValue: true,
	});
	return r.result.value;
}

/** Page coordinates of a hover/click target: literal `x,y`, or the centre of the `index`-th matching element scrolled into view (null if none). */
async function pointOf(cdp: Cdp, arg: string, index = 0): Promise<{ x: number; y: number } | null> {
	const xy = POINT.exec(arg);
	if (xy) return { x: Number(xy[1]), y: Number(xy[2]) };
	const r = await cdp.send("Runtime.evaluate", {
		expression: `(() => { const el = document.querySelectorAll(${JSON.stringify(arg)})[${index}]; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
		returnByValue: true,
	});
	return r.result.value;
}

/** Runs the same expression on the `index`-th match, so every click of an `@all` sequence sees the DOM the previous click left behind. */
const onNth = (cdp: Cdp, selector: string, index: number, body: string) =>
	cdp.send("Runtime.evaluate", { expression: `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return false; ${body}; return true; })()`, returnByValue: true });

/** What a step reported: a `problem` fails the check, a `note` just says what happened (how many elements an `@all` click hit). */
interface StepResult { problem?: string; note?: string }

/**
 * Runs one step in the page. Selectors may end in `@all` (every match, re-queried before each click, with a pause after each so handlers
 * that rebuild the DOM finish) or `@<index>` (0-based); without it the first match is used.
 */
async function runStep(cdp: Cdp, step: string, settle: (ms: number) => Promise<unknown>): Promise<StepResult> {
	const [, kind, raw] = STEP.exec(step)!;
	if (kind === "key") {
		const [vk, code] = KEYS[raw!] ?? [raw!.toUpperCase().charCodeAt(0), `Key${raw!.toUpperCase()}`];
		const key = raw === "Space" ? " " : raw!;
		const text = key.length === 1 ? key : raw === "Enter" ? "\r" : undefined;
		for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, text: type === "keyDown" ? text : undefined });
		return {};
	}
	const isPoint = POINT.test(raw!);
	const nth = isPoint ? undefined : NTH.exec(raw!)?.[1];
	const selector = isPoint ? raw! : quoteAttrValues(raw!.replace(NTH, ""));
	let indices = [Number(nth ?? 0)];
	if (!isPoint) {
		const found = await countMatches(cdp, selector);
		if ("error" in found) return { problem: `${step}: invalid CSS selector (${found.error}). Quote attribute values: [value="0"]` };
		if (nth === "all") indices = Array.from({ length: found.count }, (_, i) => i);
		if (!found.count || indices.some((i) => i >= found.count)) return { problem: `${step}: ${found.count ? `only ${found.count} element(s) match` : "no element matches"} ${selector}` };
	}
	if (kind === "focus") {
		await onNth(cdp, selector, indices[0]!, "el.focus()");
		return {};
	}
	if (kind === "click" && !isPoint) {
		// DOM click: the handler runs whatever overlaps the element, and the element is focused first so key: steps reach it.
		for (const i of indices) {
			await onNth(cdp, selector, i, "el.scrollIntoView({ block: 'center' }); el.focus?.({ preventScroll: true }); el.click()");
			if (indices.length > 1) await settle(SETTLE_MS);
		}
		return nth === "all" ? { note: `${step}: clicked ${indices.length}` } : {};
	}
	// Real mouse events, so :hover styles and pointer handlers (chart tips, marks) fire; click:x,y presses and releases there.
	const point = await pointOf(cdp, selector, indices[0]);
	if (!point) return { problem: `${step}: no element matches ${selector}` };
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	if (kind === "click") for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
	return {};
}

/** Runs in the page: every drill-down hash the page links to ("#repo/mobile") or declares (static views, data-view="a/b"), in document order; view templates nothing links to. */
const DISCOVER_JS = `(() => {
	const names = new Set([...document.querySelectorAll("[data-view]")].map((v) => v.dataset.view));
	const hashes = new Set([...names].filter((n) => n.includes("/")).map((n) => "#" + n));
	for (const a of document.querySelectorAll('a[href^="#"]')) {
		const h = a.getAttribute("href").slice(1);
		if (h && (names.has(h) || names.has(h.split("/")[0]))) hashes.add("#" + h);
	}
	const reached = (n) => [...hashes].some((h) => h === "#" + n || h.startsWith("#" + n + "/"));
	return { hashes: [...hashes], templates: [...names].filter((n) => !n.includes("/") && !reached(n)) };
})()`;
const MAX_DISCOVERED = 6;

/** The view a hash belongs to: "#repo/mobile" is a link into the view "repo". */
const viewName = (hash: string) => hash.slice(1).split("/")[0]!;

/**
 * Which views to capture from the `--view` values: none given = the first hash of each view (at most 6 views), `all` = every hash found,
 * `none` = overview only, hashes = exactly those (added to the found ones with `all`).
 */
function chooseViews(requested: string[], found: string[]): { capture: string[]; skipped: string[] } {
	const hashes = requested.filter((v) => v !== "all" && v !== "none").map((v) => (v.startsWith("#") ? v : `#${v}`));
	if (requested.includes("none")) return { capture: [], skipped: found };
	if (requested.includes("all")) return { capture: [...new Set([...hashes, ...found])], skipped: [] };
	if (hashes.length) return { capture: hashes, skipped: found.filter((f) => !hashes.includes(f)) };
	const firsts = found.filter((h, i) => found.findIndex((o) => viewName(o) === viewName(h)) === i).slice(0, MAX_DISCOVERED);
	return { capture: firsts, skipped: found.filter((h) => !firsts.includes(h)) };
}

/**
 * Opens `file` in headless Chrome for every theme x viewport and writes PNGs to `outDir`:
 * the first viewport before any step, the full page after the `--do` steps (their state persists into those shots), and a full-page shot
 * of each chosen drill-down view (see chooseViews), each loaded fresh from its hash, so no `--do` state applies to views.
 * Reports console/page errors, network requests, failed loads and page-level horizontal overflow (problems), and warnings
 * (console warnings, sideways-scrolling containers, tiny diagram text, a missing viewport meta, tall diagrams and charts). Reduced motion is emulated so animations are finished in the shots.
 */
export async function check(file: string, outDir: string, opts: CheckOptions): Promise<CheckResult> {
	const url = `file://${resolve(file)}`;
	mkdirSync(outDir, { recursive: true });
	const shots: Shot[] = [];
	const views: ViewReport = { found: [], captured: [], uncaptured: [], templates: [] };
	const stepNotes = new Set<string>();
	const stem = `${basename(file).replace(/\.html?$/, "")}${opts.tag ? `-${opts.tag}` : ""}`;
	const themes = opts.quick ? THEMES.slice(0, 1) : THEMES;
	await withPage(async (cdp) => {
		let problems: string[] = [];
		let consoleWarnings: string[] = [];
		const shorten = (text: string) => (text.length > 220 ? `${text.slice(0, 217)}...` : text);
		cdp.on((method, p) => {
			if (method === "Runtime.exceptionThrown") problems.push(`page error: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`.split("\n")[0]!);
			if (method === "Runtime.consoleAPICalled" && p.type === "error") problems.push(`console.error: ${p.args.map((a: any) => a.value ?? a.description).join(" ")}`);
			if (method === "Runtime.consoleAPICalled") {
				const text = p.args.map((a: any) => a.value ?? a.description).join(" ");
				// ECharts reports its own warnings (bad option, missing component) with console.log, so its prefix counts as a warning too.
				if (p.type === "warning" || /^\[ECharts\]/.test(text)) consoleWarnings.push(shorten(`console.${p.type}: ${text}`) + (/grid\.containLabel/.test(text) ? " [kit: delete containLabel; charts.js already keeps axis labels inside the grid margins]" : ""));
			}
			if (method === "Log.entryAdded" && p.entry.level === "warning" && p.entry.source !== "console-api") consoleWarnings.push(shorten(`${p.entry.source} warning: ${p.entry.text}`));
			if (method === "Log.entryAdded" && p.entry.level === "error") problems.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url ?? ""}`);
			if (method === "Network.requestWillBeSent" && /^(https?|wss?|ftp):/.test(p.request.url)) problems.push(`network request: ${p.request.url}`);
			if (method === "Network.loadingFailed" && !p.canceled) problems.push(`failed load: ${p.errorText}`);
		});
		await Promise.all(["Page", "Runtime", "Log", "Network"].map((d) => cdp.send(`${d}.enable`)));
		const settle = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
		const evaluate = async <T>(expression: string): Promise<T> => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
		/** Loads the page fresh (via about:blank, so a hash-only change is a real load), then lets scripts settle. */
		const open = async (hash: string) => {
			await cdp.send("Page.navigate", { url: "about:blank" });
			const loaded = cdp.once("Page.loadEventFired");
			await cdp.send("Page.navigate", { url: url + hash });
			await loaded;
			await settle(400);
		};
		/** Full-page PNG plus the page analysis for whatever the page currently shows; returns the warnings. */
		const capture = async (png: string, vp: { width: number }, narrow: boolean): Promise<string[]> => {
			const page = await evaluate<{ overflow: boolean; culprits: string[]; scrolls: string[]; warnings: string[] }>(PAGE_JS(narrow));
			if (page.overflow) problems.push(`horizontal page overflow at ${vp.width}px; outside any scroll container: ${page.culprits.join(", ") || "unknown"}`);
			const { contentSize } = await cdp.send("Page.getLayoutMetrics");
			const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: Math.ceil(contentSize.height), scale: 1 } });
			writeFileSync(png, Buffer.from(data, "base64"));
			return [...page.warnings, ...page.scrolls.map((s) => `scrolls sideways: ${s}`), ...new Set(consoleWarnings)];
		};
		let hashes: string[] = [];
		for (const theme of themes) for (const [name, vp] of Object.entries(VIEWPORTS)) {
			const viewport = `${name} ${vp.width}x${vp.height}`;
			const narrow = name === "narrow";
			await cdp.send("Emulation.setDeviceMetricsOverride", { ...vp, deviceScaleFactor: 1, mobile: narrow });
			await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
			problems = [];
			consoleWarnings = [];
			await open("");
			let first: FirstScreen | undefined;
			if (!opts.quick) {
				const png = join(outDir, `${stem}-first-${theme}-${name}.png`);
				const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
				writeFileSync(png, Buffer.from(data, "base64"));
				first = { png, ...(await evaluate<{ headline: string; figures: string[] }>(FIRST_SCREEN_JS)) };
			}
			if (theme === THEMES[0] && name === "desktop") {
				const found = await evaluate<{ hashes: string[]; templates: string[] }>(DISCOVER_JS);
				const chosen = chooseViews(opts.views, found.hashes);
				hashes = chosen.capture;
				views.found = found.hashes;
				views.uncaptured = chosen.skipped;
				views.templates = found.templates;
			}
			for (const step of opts.steps) {
				const result = await runStep(cdp, step, settle);
				if (result.problem) problems.push(`--do ${result.problem}`);
				if (result.note) stepNotes.add(result.note);
				await settle(200);
			}
			const png = join(outDir, opts.quick ? `${opts.tag ? `${opts.tag}-` : ""}${name}.png` : `${stem}-${theme}-${name}.png`);
			const warnings = await capture(png, vp, narrow);
			shots.push({ theme, viewport, view: "", png, first, problems: [...new Set(problems)], warnings });
			for (const hash of hashes) {
				problems = [];
				consoleWarnings = [];
				await open(hash);
				const active = await evaluate<boolean>(`document.documentElement.classList.contains("in-view")`);
				if (!active) problems.push(`${hash}: no view is shown for this hash`);
				const slug = hash.slice(1).replace(/[^\w-]+/g, "-");
				const viewPng = join(outDir, `${stem}-view-${slug}-${theme}-${name}.png`);
				const viewWarnings = await capture(viewPng, vp, narrow);
				shots.push({ theme, viewport, view: hash, png: viewPng, problems: [...new Set(problems)], warnings: viewWarnings });
				if (!views.captured.includes(hash)) views.captured.push(hash);
			}
		}
	});
	return { shots, views, stepNotes: [...stepNotes] };
}
