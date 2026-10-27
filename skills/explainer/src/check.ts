import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Cdp, ExceptionDetails } from "./cdp.ts";
import { ChromeError } from "./cdp.ts";
import { withPage } from "./chrome.ts";
import { TIMERS_JS, TIMERS_URL } from "./page-js.ts";
import {
	DISCOVER_JS,
	FIRST_SCREEN_JS,
	PAGE_JS,
	type PageReport,
	STEPPERS_JS,
	SWEEP_JS,
} from "./page-probes.ts";
import { runStep, settlePage } from "./steps.ts";

const VIEWPORTS = {
	desktop: { width: 1440, height: 900 },
	narrow: { width: 390, height: 844 },
} as const;
const STACK_FRAMES = 3;
const THEMES = ["light", "dark"] as const;
/**
 * The first viewport before any `--do` step: its PNG, the headline, the figures a reader sees without scrolling, and `links`: the most
 * in-page links (href="#...") that one list shows in the viewport, i.e. a text map of the page's questions or sections.
 */
export interface FirstScreen {
	png: string;
	headline: string;
	figures: string[];
	links: number;
}
/** A PNG of one element, written by a `--do shot:` step. */
export interface ElementShot {
	step: string;
	png: string;
}
/**
 * `view` is the hash of a drill-down view ("" for the overview); `first` describes the first viewport, taken before any step (overview only).
 * `elements` are the `--do shot:` PNGs, in step order (overview only; views run no steps).
 * `problems` fail the check; `warnings` are worth a look but do not (console warnings, sideways-scrolling containers, tiny diagram text,
 * a missing viewport meta, content cut off in a clipping box, a diagram or chart taller than 1.5 viewports, a stepper whose steps
 * change only its captions).
 */
export interface Shot {
	theme: string;
	viewport: string;
	view: string;
	png: string;
	first?: FirstScreen | undefined;
	elements: ElementShot[];
	problems: string[];
	warnings: string[];
}
/**
 * `quick`: light theme only, no first-viewport shots, overview PNGs named desktop.png and narrow.png. `views` are --view values:
 * hashes, "all" or "none". `timeoutSeconds`: the whole run's limit, past which check stops Chrome and throws a ChromeError.
 */
export interface CheckOptions {
	steps: string[];
	views: string[];
	tag: string;
	quick: boolean;
	timeoutSeconds: number;
}

/** The overall limit of one check run when --timeout gives none: far above a page with every view captured and many steps. */
export const DEFAULT_TIMEOUT_SECONDS = 600;
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

/**
 * The distinct `kit:` references in page source: they only resolve after `pack`, so a page that has them is not ready to check.
 * Parsed as HTML, so a `"kit:..."` inside a script's text or an escaped code sample is not mistaken for an unpacked page.
 */
export async function kitReferences(html: string): Promise<string[]> {
	const refs = new Set<string>();
	const collect = (attr: string) => ({
		element(el: { getAttribute(name: string): string | null }) {
			refs.add(el.getAttribute(attr) ?? "");
		},
	});
	await new HTMLRewriter()
		.on('[href^="kit:"]', collect("href"))
		.on('[src^="kit:"]', collect("src"))
		.transform(new Response(html))
		.text();
	return [...refs];
}

/** The most views a check captures when `--view` names none. */
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
			this.problems.push(`${message.split("\n")[0] ?? message} (at ${errorLocation(d)})`);
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

/** Where an exception was thrown, in the page's own line:column: the top frames ("fmt 3:38, render 4:28") or, without a stack (a syntax error), the position alone. */
function errorLocation(d: ExceptionDetails): string {
	const frames = (d.stackTrace?.callFrames ?? [])
		.filter((f) => f.url !== TIMERS_URL)
		.slice(0, STACK_FRAMES);
	if (!frames.length) {
		return `${d.lineNumber + 1}:${d.columnNumber + 1}`;
	}
	return frames
		.map((f) => `${f.functionName || "<anonymous>"} ${f.lineNumber + 1}:${f.columnNumber + 1}`)
		.join(", ");
}

const consoleText = (args: Array<{ value?: unknown; description?: string }>) =>
	args.map((a) => a.value ?? a.description ?? "").join(" ");
const shorten = (text: string) => (text.length > 220 ? `${text.slice(0, 217)}...` : text);

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
	/** The drill-down hashes to capture, set once by the first overview pass (light, desktop) and reused for every other screen. */
	viewHashes: string[];
	stepNotes: Set<string>;
	/** What the run is doing now ("dark narrow, view #fix/none"), for an error that stops it. */
	at: string;
}

/**
 * Loads the page fresh (via about:blank, so a hash-only change is a real load), then waits until it has settled (settlePage); what
 * is still missing then is a problem of the shot. Local storage is emptied once the old page is gone: every file:// page shares one
 * origin and one profile serves all shots, so a page that keeps what the reader entered (kit:keep.js) would otherwise carry one
 * shot's `--do` state into the next, and the old page saves again as it unloads.
 */
async function open(run: Run, hash: string) {
	const { cdp } = run;
	await cdp.load("about:blank");
	await cdp.send("Storage.clearDataForOrigin", {
		origin: "file://",
		storageTypes: "local_storage",
	});
	await cdp.load(run.url + hash);
	const missing = await settlePage(cdp);
	if (missing) {
		run.log.problems.push(`${hash ? `${hash}: ` : ""}${missing}`);
	}
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
	const page = await cdp.evaluate<PageReport>(PAGE_JS(narrow));
	log.problems.push(...page.repeated);
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

/**
 * The path of an overview PNG for one screen, `part` saying what it shows beyond the full page: `<stem>[-<part>]-<theme>-<size>.png`,
 * or under --quick, whose one theme the name leaves out, `[<tag>-][<part>-]<size>.png`.
 */
function overviewPng(run: Run, { theme, name }: Screen, part = "") {
	const { tag, quick } = run.opts;
	const parts = quick ? [tag, part, name] : [run.stem, part, theme, name];
	return join(run.outDir, `${parts.filter(Boolean).join("-")}.png`);
}

/** The first viewport before any step: PNG, headline and the figures in view. */
async function firstScreen(run: Run, screen: Screen): Promise<FirstScreen> {
	const png = overviewPng(run, screen, "first");
	const { data } = await run.cdp.send<{ data: string }>("Page.captureScreenshot", {
		format: "png",
	});
	writeFileSync(png, Buffer.from(data, "base64"));
	return {
		png,
		...(await run.cdp.evaluate<Omit<FirstScreen, "png">>(FIRST_SCREEN_JS)),
	};
}

/** Scrolls the page end to end and back, so what only runs on scroll (observers, scroll listeners) runs before the shots; ends at the top. */
const sweep = (run: Run) => run.cdp.evaluate(SWEEP_JS, true);

/** Finds the drill-down hashes on the freshly loaded overview and records them in the report and in `run.viewHashes`. */
async function discoverViews(run: Run) {
	const found = await run.cdp.evaluate<{ hashes: string[]; templates: string[] }>(DISCOVER_JS);
	const chosen = chooseViews(run.opts.views, found.hashes);
	run.views.found = found.hashes;
	run.views.uncaptured = chosen.skipped;
	run.views.templates = found.templates;
	run.viewHashes = chosen.capture;
}

/**
 * The `part` of a `--do shot:` PNG's name: the shot's ordinal among the shot: steps, the selector as a slug, then the match index
 * when the step names one (`shot2-card-0`, as in `example-shot2-card-0-light-desktop.png`).
 */
function shotPart(ordinal: number, selector: string, index: number | undefined) {
	const slug =
		selector
			.replace(/[^\w-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "element";
	return `shot${ordinal}-${slug}${index === undefined ? "" : `-${index}`}`;
}

/** Runs the `--do` steps in order, recording their problems and notes; returns the PNGs the shot: steps wrote. */
async function runSteps(run: Run, screen: Screen): Promise<ElementShot[]> {
	const elements: ElementShot[] = [];
	let ordinal = 0;
	for (const step of run.opts.steps) {
		const shot = step.startsWith("shot:") ? ++ordinal : 0;
		const result = await runStep(run.cdp, step, (selector, index) =>
			overviewPng(run, screen, shotPart(shot, selector, index)),
		);
		if (result.problem) {
			run.log.problems.push(`--do ${result.problem}`);
		}
		if (result.note) {
			run.stepNotes.add(result.note);
		}
		elements.push(...(result.pngs ?? []).map((png) => ({ step, png })));
	}
	return elements;
}

/** The overview page for one theme and viewport: first screen, view discovery (first screen only), `--do` steps, full-page shot. */
async function shootOverview(run: Run, screen: Screen) {
	const { theme, name, vp } = screen;
	const { opts } = run;
	run.at = `${theme} ${name}, overview`;
	run.log.reset();
	await open(run, "");
	const first = opts.quick ? undefined : await firstScreen(run, screen);
	const firstPass = theme === THEMES[0] && name === "desktop";
	if (firstPass) {
		await discoverViews(run);
	}
	await sweep(run);
	// Stepping behaves the same in every theme and width, so one pass finds a stepper that changes nothing.
	const stepperWarnings = firstPass ? await run.cdp.evaluate<string[]>(STEPPERS_JS, true) : [];
	const elements = await runSteps(run, screen);
	const png = overviewPng(run, screen);
	const warnings = [...stepperWarnings, ...(await capture(run, png, screen))];
	run.shots.push({
		theme,
		viewport: `${name} ${vp.width}x${vp.height}`,
		view: "",
		png,
		first,
		elements,
		problems: [...new Set(run.log.problems)],
		warnings,
	});
}

/** One drill-down view, loaded fresh from its hash so no `--do` state applies. */
async function shootView(run: Run, screen: Screen, hash: string) {
	const { theme, name, vp } = screen;
	run.at = `${theme} ${name}, view ${hash}`;
	run.log.reset();
	await open(run, hash);
	if (
		!(await run.cdp.evaluate<boolean>(`document.documentElement.classList.contains("in-view")`))
	) {
		run.log.problems.push(`${hash}: no view is shown for this hash`);
	}
	await sweep(run);
	const slug = hash.slice(1).replace(/[^\w-]+/g, "-");
	const png = join(run.outDir, `${run.stem}-view-${slug}-${theme}-${name}.png`);
	const warnings = await capture(run, png, screen);
	run.shots.push({
		theme,
		viewport: `${name} ${vp.width}x${vp.height}`,
		view: hash,
		png,
		elements: [],
		problems: [...new Set(run.log.problems)],
		warnings,
	});
	if (!run.views.captured.includes(hash)) {
		run.views.captured.push(hash);
	}
}

/** Every theme x viewport: the overview, then each chosen view. */
async function shootAll(run: Run, themes: readonly string[]) {
	const { cdp } = run;
	await Promise.all(["Page", "Runtime", "Log", "Network"].map((d) => cdp.send(`${d}.enable`)));
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TIMERS_JS });
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
			await shootOverview(run, screen);
			for (const hash of run.viewHashes) {
				await shootView(run, screen, hash);
			}
		}
	}
}

/**
 * Runs shootAll within the run's overall limit. Past it, every pending and later Chrome call fails with the limit's error, which
 * says where the run was; any other ChromeError gets the same `at` added, so a stalled call names the screen it stalled on.
 */
async function shootWithin(run: Run, themes: readonly string[]) {
	const { timeoutSeconds } = run.opts;
	let stopped: ChromeError | undefined;
	const limit = setTimeout(() => {
		stopped = new ChromeError(
			`check passed its ${timeoutSeconds} s limit at ${run.at}, after ${run.shots.length} page(s): raise --timeout for a page with many views or --do steps`,
		);
		run.cdp.abort(stopped);
	}, timeoutSeconds * 1000);
	try {
		await shootAll(run, themes);
	} catch (error) {
		if (error instanceof ChromeError && error !== stopped) {
			throw new ChromeError(`${error.message} (at ${run.at})`);
		}
		throw error;
	} finally {
		clearTimeout(limit);
	}
}

/**
 * Opens `file` in headless Chrome for every theme x viewport and writes PNGs to `outDir`:
 * the first viewport before any step, the full page after a scroll sweep (see SWEEP_JS) and the `--do` steps (their state persists into those shots), and a full-page shot
 * of each chosen drill-down view (see chooseViews), each loaded fresh from its hash, so no `--do` state applies to views.
 * Each load and step is followed by a wait until the page has settled (settlePage: frames, fonts, charts drawn, short timers), not a fixed time.
 * Reports console/page errors, network requests, failed loads, page-level horizontal overflow, repeated ids and what a page had still not drawn at
 * the settle deadline (problems), and warnings
 * (console warnings, sideways-scrolling containers, cut-off content, tiny diagram text, a missing viewport meta, tall diagrams and charts, steppers that change only their captions). Reduced motion is emulated so animations are finished in the shots.
 * A ChromeError ends the run with no result: Chrome failed to start or stalled, or the run passed `opts.timeoutSeconds`.
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
	await withPage((cdp) =>
		shootWithin(
			{
				cdp,
				log: new PageLog(cdp),
				url: `file://${resolve(file)}`,
				outDir,
				stem,
				opts,
				shots,
				views,
				viewHashes: [],
				stepNotes,
				at: "starting",
			},
			themes,
		),
	);
	return { shots, views, stepNotes: [...stepNotes] };
}
