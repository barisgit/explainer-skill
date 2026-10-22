import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Cdp } from "./chrome.ts";
import { withPage } from "./chrome.ts";
import { runStep } from "./steps.ts";

const VIEWPORTS = {
	desktop: { width: 1440, height: 900 },
	narrow: { width: 390, height: 844 },
} as const;
const THEMES = ["light", "dark"] as const;
/** The first viewport before any `--do` step: its PNG, the headline and the figures a reader sees without scrolling. */
export interface FirstScreen {
	png: string;
	headline: string;
	figures: string[];
}
/**
 * `view` is the hash of a drill-down view ("" for the overview); `first` describes the first viewport, taken before any step (overview only).
 * `problems` fail the check; `warnings` are worth a look but do not (console warnings, sideways-scrolling containers, tiny diagram text,
 * a missing viewport meta, a diagram or chart taller than 1.5 viewports).
 */
export interface Shot {
	theme: string;
	viewport: string;
	view: string;
	png: string;
	first?: FirstScreen | undefined;
	problems: string[];
	warnings: string[];
}
/** `quick`: light theme only, no first-viewport shots, overview PNGs named desktop.png and narrow.png. `views` are --view values: hashes, "all" or "none". */
export interface CheckOptions {
	steps: string[];
	views: string[];
	tag: string;
	quick: boolean;
}
/** `found`: every drill-down hash the overview links to or declares; `uncaptured`: those not captured; `templates`: view names with a param that no link reaches. */
export interface ViewReport {
	found: string[];
	captured: string[];
	uncaptured: string[];
	templates: string[];
}
export interface CheckResult {
	shots: Shot[];
	views: ViewReport;
	stepNotes: string[];
}

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
const viewName = (hash: string) => hash.slice(1).split("/")[0] ?? "";

/**
 * Which views to capture from the `--view` values: none given = the first hash of each view (at most 6 views), `all` = every hash found,
 * `none` = overview only, hashes = exactly those (added to the found ones with `all`).
 */
function chooseViews(
	requested: string[],
	found: string[],
): { capture: string[]; skipped: string[] } {
	const hashes = requested
		.filter((v) => v !== "all" && v !== "none")
		.map((v) => (v.startsWith("#") ? v : `#${v}`));
	if (requested.includes("none")) {
		return { capture: [], skipped: found };
	}
	if (requested.includes("all")) {
		return { capture: [...new Set([...hashes, ...found])], skipped: [] };
	}
	if (hashes.length) {
		return { capture: hashes, skipped: found.filter((f) => !hashes.includes(f)) };
	}
	const firsts = found
		.filter((h, i) => found.findIndex((o) => viewName(o) === viewName(h)) === i)
		.slice(0, MAX_DISCOVERED);
	return { capture: firsts, skipped: found.filter((h) => !firsts.includes(h)) };
}

/** Collects what the page reports while it loads and runs: problems fail the check, warnings are only listed. */
class PageLog {
	problems: string[] = [];
	warnings: string[] = [];

	constructor(cdp: Cdp) {
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) => {
			const message = `page error: ${d.exception?.description ?? d.text}`;
			this.problems.push(message.split("\n")[0] ?? message);
		});
		cdp.on("Runtime.consoleAPICalled", ({ type, args }) => this.onConsole(type, consoleText(args)));
		cdp.on("Log.entryAdded", ({ entry }) => {
			if (entry.level === "warning" && entry.source !== "console-api") {
				this.warnings.push(shorten(`${entry.source} warning: ${entry.text}`));
			}
			if (entry.level === "error") {
				this.problems.push(`${entry.source}: ${entry.text} ${entry.url ?? ""}`);
			}
		});
		cdp.on("Network.requestWillBeSent", ({ request }) => {
			if (/^(https?|wss?|ftp):/.test(request.url)) {
				this.problems.push(`network request: ${request.url}`);
			}
		});
		cdp.on("Network.loadingFailed", ({ canceled, errorText }) => {
			if (!canceled) {
				this.problems.push(`failed load: ${errorText}`);
			}
		});
	}

	/** Forgets everything reported so far, before the next page load. */
	reset() {
		this.problems = [];
		this.warnings = [];
	}

	private onConsole(type: string, text: string) {
		if (type === "error") {
			this.problems.push(`console.error: ${text}`);
		}
		// ECharts reports its own warnings (bad option, missing component) with console.log, so its prefix counts as a warning too.
		if (type === "warning" || /^\[ECharts\]/.test(text)) {
			const hint = /grid\.containLabel/.test(text)
				? " [kit: delete containLabel; charts.js already keeps axis labels inside the grid margins]"
				: "";
			this.warnings.push(shorten(`console.${type}: ${text}`) + hint);
		}
	}
}

const consoleText = (args: Array<{ value?: unknown; description?: string }>) =>
	args.map((a) => a.value ?? a.description ?? "").join(" ");
const shorten = (text: string) => (text.length > 220 ? `${text.slice(0, 217)}...` : text);
const settle = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Everything one check run shares: the page, its log, where files go, and what has been collected. */
interface Run {
	cdp: Cdp;
	log: PageLog;
	url: string;
	outDir: string;
	stem: string;
	opts: CheckOptions;
	shots: Shot[];
	views: ViewReport;
	stepNotes: Set<string>;
}

/** Loads the page fresh (via about:blank, so a hash-only change is a real load), then lets scripts settle. */
async function open(run: Run, hash: string) {
	const { cdp } = run;
	await cdp.send("Page.navigate", { url: "about:blank" });
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url: run.url + hash });
	await loaded;
	await settle(400);
}

interface Screen {
	theme: string;
	name: string;
	vp: { width: number; height: number };
}

/** Full-page PNG plus the page analysis for whatever the page currently shows; returns the warnings. */
async function capture(run: Run, png: string, screen: Screen): Promise<string[]> {
	const { cdp, log } = run;
	const narrow = screen.name === "narrow";
	const page = await cdp.evaluate<{
		overflow: boolean;
		culprits: string[];
		scrolls: string[];
		warnings: string[];
	}>(PAGE_JS(narrow));
	if (page.overflow) {
		log.problems.push(
			`horizontal page overflow at ${screen.vp.width}px; outside any scroll container: ${page.culprits.join(", ") || "unknown"}`,
		);
	}
	const { contentSize } = await cdp.send<{ contentSize: { height: number } }>(
		"Page.getLayoutMetrics",
	);
	const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: true,
		clip: { x: 0, y: 0, width: screen.vp.width, height: Math.ceil(contentSize.height), scale: 1 },
	});
	writeFileSync(png, Buffer.from(data, "base64"));
	return [
		...page.warnings,
		...page.scrolls.map((s) => `scrolls sideways: ${s}`),
		...new Set(log.warnings),
	];
}

/** The first viewport before any step: PNG, headline and the figures in view. */
async function firstScreen(run: Run, { theme, name }: Screen): Promise<FirstScreen> {
	const png = join(run.outDir, `${run.stem}-first-${theme}-${name}.png`);
	const { data } = await run.cdp.send<{ data: string }>("Page.captureScreenshot", {
		format: "png",
	});
	writeFileSync(png, Buffer.from(data, "base64"));
	return {
		png,
		...(await run.cdp.evaluate<{ headline: string; figures: string[] }>(FIRST_SCREEN_JS)),
	};
}

/** Finds the drill-down hashes on the freshly loaded overview, records them in the report and returns those to capture. */
async function discoverViews(run: Run): Promise<string[]> {
	const found = await run.cdp.evaluate<{ hashes: string[]; templates: string[] }>(DISCOVER_JS);
	const chosen = chooseViews(run.opts.views, found.hashes);
	run.views.found = found.hashes;
	run.views.uncaptured = chosen.skipped;
	run.views.templates = found.templates;
	return chosen.capture;
}

/** Runs the `--do` steps in order, recording their problems and notes. */
async function runSteps(run: Run) {
	for (const step of run.opts.steps) {
		const result = await runStep(run.cdp, step, settle);
		if (result.problem) {
			run.log.problems.push(`--do ${result.problem}`);
		}
		if (result.note) {
			run.stepNotes.add(result.note);
		}
		await settle(200);
	}
}

/** The overview page for one theme and viewport: first screen, view discovery, `--do` steps, full-page shot. */
async function shootOverview(run: Run, screen: Screen): Promise<string[]> {
	const { theme, name, vp } = screen;
	const { opts } = run;
	run.log.reset();
	await open(run, "");
	const first = opts.quick ? undefined : await firstScreen(run, screen);
	const hashes = theme === THEMES[0] && name === "desktop" ? await discoverViews(run) : [];
	await runSteps(run);
	const png = join(
		run.outDir,
		opts.quick
			? `${opts.tag ? `${opts.tag}-` : ""}${name}.png`
			: `${run.stem}-${theme}-${name}.png`,
	);
	const warnings = await capture(run, png, screen);
	run.shots.push({
		theme,
		viewport: `${name} ${vp.width}x${vp.height}`,
		view: "",
		png,
		first,
		problems: [...new Set(run.log.problems)],
		warnings,
	});
	return hashes;
}

/** One drill-down view, loaded fresh from its hash so no `--do` state applies. */
async function shootView(run: Run, screen: Screen, hash: string) {
	const { theme, name, vp } = screen;
	run.log.reset();
	await open(run, hash);
	if (
		!(await run.cdp.evaluate<boolean>(`document.documentElement.classList.contains("in-view")`))
	) {
		run.log.problems.push(`${hash}: no view is shown for this hash`);
	}
	const slug = hash.slice(1).replace(/[^\w-]+/g, "-");
	const png = join(run.outDir, `${run.stem}-view-${slug}-${theme}-${name}.png`);
	const warnings = await capture(run, png, screen);
	run.shots.push({
		theme,
		viewport: `${name} ${vp.width}x${vp.height}`,
		view: hash,
		png,
		problems: [...new Set(run.log.problems)],
		warnings,
	});
	if (!run.views.captured.includes(hash)) {
		run.views.captured.push(hash);
	}
}

/**
 * Opens `file` in headless Chrome for every theme x viewport and writes PNGs to `outDir`:
 * the first viewport before any step, the full page after the `--do` steps (their state persists into those shots), and a full-page shot
 * of each chosen drill-down view (see chooseViews), each loaded fresh from its hash, so no `--do` state applies to views.
 * Reports console/page errors, network requests, failed loads and page-level horizontal overflow (problems), and warnings
 * (console warnings, sideways-scrolling containers, tiny diagram text, a missing viewport meta, tall diagrams and charts). Reduced motion is emulated so animations are finished in the shots.
 */
export async function check(
	file: string,
	outDir: string,
	opts: CheckOptions,
): Promise<CheckResult> {
	mkdirSync(outDir, { recursive: true });
	const themes = opts.quick ? THEMES.slice(0, 1) : THEMES;
	const stem = `${basename(file).replace(/\.html?$/, "")}${opts.tag ? `-${opts.tag}` : ""}`;
	const shots: Shot[] = [];
	const views: ViewReport = { found: [], captured: [], uncaptured: [], templates: [] };
	const stepNotes = new Set<string>();
	await withPage(async (cdp) => {
		const run: Run = {
			cdp,
			log: new PageLog(cdp),
			url: `file://${resolve(file)}`,
			outDir,
			stem,
			opts,
			shots,
			views,
			stepNotes,
		};
		await Promise.all(["Page", "Runtime", "Log", "Network"].map((d) => cdp.send(`${d}.enable`)));
		let hashes: string[] = [];
		for (const theme of themes) {
			for (const [name, vp] of Object.entries(VIEWPORTS)) {
				const narrow = name === "narrow";
				await cdp.send("Emulation.setDeviceMetricsOverride", {
					...vp,
					deviceScaleFactor: 1,
					mobile: narrow,
				});
				await cdp.send("Emulation.setEmulatedMedia", {
					features: [
						{ name: "prefers-color-scheme", value: theme },
						{ name: "prefers-reduced-motion", value: "reduce" },
					],
				});
				const screen = { theme, name, vp };
				const discovered = await shootOverview(run, screen);
				hashes = theme === THEMES[0] && name === "desktop" ? discovered : hashes;
				for (const hash of hashes) {
					await shootView(run, screen, hash);
				}
			}
		}
	});
	return { shots, views, stepNotes: [...stepNotes] };
}
