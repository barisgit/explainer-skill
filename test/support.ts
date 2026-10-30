import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { renderMermaid } from "../skills/explainer/src/mermaid.ts";
import { packPage } from "../skills/explainer/src/pack.ts";
import { PackError } from "../skills/explainer/src/pack-error.ts";
import { SETTLE_JS } from "../skills/explainer/src/page-js.ts";
import { runStep, type ShotPath } from "../skills/explainer/src/steps.ts";
import { withTestPage } from "./browser.ts";

/** The skill directory as an installer would copy it. */
export const SKILL_DIR = join(import.meta.dir, "..", "skills", "explainer");

export interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs `bun skills/explainer/cli.ts <args>` the way an agent would and captures its streams. */
export async function runCli(args: string[]): Promise<CliResult> {
	const proc = Bun.spawn([process.execPath, join(SKILL_DIR, "cli.ts"), ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

/** What packHtml made of a page: `error` is the PackError's message (empty when it packed), `warnings` what pack would print. */
export interface Packed {
	error: string;
	warnings: string[];
}

/**
 * Packs a hand-written HTML page through pack's pipeline after prerendering (packPage), writing `output` when it packs. Authors
 * pack only .mdx; the tests of the kit runtime and of the HTML pass write the markup the components render by hand.
 */
export async function packHtml(input: string, output: string): Promise<Packed> {
	try {
		const { html, warnings } = await packPage(dirname(input), (drawDiagrams) =>
			drawDiagrams(readFileSync(input, "utf8")),
		);
		writeFileSync(output, html);
		return { error: "", warnings };
	} catch (e) {
		if (!(e instanceof PackError)) {
			throw e;
		}
		return { error: e.message, warnings: [] };
	}
}

/** Packs `source` as `<name>.mdx` in `dir`, with `files` written beside it first; returns the CLI result and the output path. */
export async function packMdx(
	dir: ReturnType<typeof scratch>,
	name: string,
	source: string,
	files: Record<string, string> = {},
): Promise<{ result: CliResult; output: string }> {
	for (const [file, text] of Object.entries(files)) {
		dir.write(file, text);
	}
	const output = dir.path(`${name}.out.html`);
	return { result: await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]), output };
}

/** packMdx for a page that must pack: fails the test unless pack succeeds with nothing on stderr; returns the output path. */
export async function packedMdx(
	dir: ReturnType<typeof scratch>,
	name: string,
	source: string,
	files: Record<string, string> = {},
): Promise<string> {
	const { result, output } = await packMdx(dir, name, source, files);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	return output;
}

/** The kit scripts a page can include, in the order pack writes them. */
const KIT_SCRIPTS = ["echarts", "charts", "plot", "views", "steps", "link", "keep", "reply"];

/** The kit scripts the packed file includes, found by the documentation comment pack puts in front of each. */
export const kitScriptsIn = (file: string): string[] => {
	const html = readFileSync(file, "utf8");
	return KIT_SCRIPTS.filter((name) => html.includes(`/* ${name}: `));
};

/** A temporary directory that is removed by `cleanup()`, with a helper to write files into it. */
export function scratch() {
	const root = mkdtempSync(join(tmpdir(), "explainer-test-"));
	return {
		path: (name: string) => join(root, name),
		write(name: string, content: string): string {
			const file = join(root, name);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
			return file;
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

/**
 * Page script that throws "<contract>: <name>" when `body` is false 300 ms after each load. Each contract gets its own throw, so
 * one failure does not hide the others; check reports them as page errors. check waits after every load and step for the timers
 * of up to 1 s a page has pending, so the assertion always runs before check measures and a false one is always reported. A page
 * that needs no `--do` step or `--view` load uses pageContract instead (#38).
 */
export const pageAssertion = (contract: string, name: string, body: string) =>
	`addEventListener("load", () => setTimeout(() => { if (!(${body})) throw new Error("${contract}: ${name}"); }, 300));`;

/**
 * Packs `page` as `<name>.html` in `dir` and runs `check --quick` on the result with `args`; fails the test when either command
 * fails or a page script threw one of `contract`'s errors (see `pageAssertion`).
 */
export async function packAndCheck(
	dir: ReturnType<typeof scratch>,
	name: string,
	page: string,
	contract: string,
	args: string[],
) {
	const output = dir.path(`${name}.out.html`);
	const packed = await packHtml(dir.write(`${name}.html`, page), output);
	expect(packed.error).toBe("");
	const checked = await runCli(["check", output, "--quick", "--out", dir.path(name), ...args]);
	expect(checked.stdout).not.toContain(contract);
	expect(checked.code).toBe(0);
}

/**
 * Page script defining `settled`, a promise of the moment a page has drawn what its load starts: after the load event, then a task
 * queued behind the kit's own load-time tasks, the fonts (charts and plots redraw when theirs arrive), and two frames, so the first
 * resize callbacks have run. Each step is a signal, not a time, so a slow machine only makes the wait longer.
 */
export const SETTLED = `const settled = new Promise((loaded) => addEventListener("load", () => setTimeout(loaded)))
	.then(() => document.fonts.ready)
	.then(() => new Promise(requestAnimationFrame))
	.then(() => new Promise(requestAnimationFrame));`;

/**
 * Page script for packAndRun: once the page has `settled` and packAndRun's `steps` have run (`stepsDone`, defined only when there
 * are steps), evaluates each check in order (one may act, such as a click, for the next) and resolves `contract` with the names of
 * those that are false.
 */
export const pageContract = (checks: Record<string, string>) => `${SETTLED}
var contract = settled.then(() => window.stepsDone).then(() => [${Object.entries(checks)
	.map(([name, body]) => `(${body}) ? "" : ${JSON.stringify(name)}`)
	.join(",\n")}].filter(Boolean));`;

/** A window size a page runs at; `mobile` emulates a phone (touch, mobile viewport). */
export interface Viewport {
	width: number;
	height: number;
	mobile: boolean;
}

/** The desktop window `check` shoots first. */
export const DESKTOP: Viewport = { width: 1440, height: 900, mobile: false };

/** The widths `check` shoots, desktop then phone, so a page run covers the same layouts. */
export const WIDTHS: Viewport[] = [DESKTOP, { width: 390, height: 844, mobile: true }];

/** How packAndRun runs a page; every field has the default given here. */
export interface RunOptions {
	/** How many times the CPU is slowed; 1 runs at full speed. */
	slowdown?: number;
	/** "print" runs the page as it prints. */
	media?: "screen" | "print";
	/** The window sizes, in order; default the two `check` uses. */
	widths?: Viewport[];
	/** `check --do` steps, run in order at each width once the page has `settled`, before its pageContract checks. */
	steps?: string[];
}

/** Defines `stepsDone` before any page script runs, so a pageContract waits until `finishSteps()` says the steps have run. */
const AWAIT_STEPS = "window.stepsDone = new Promise((done) => { window.finishSteps = done; });";

/**
 * Runs `steps` in the open page once it has `settled`, then lets its contract go on; returns the problems the steps reported. A
 * shot: step writes to `shotPath`.
 */
async function runSteps(cdp: Cdp, steps: string[], shotPath: ShotPath): Promise<string[]> {
	await cdp.evaluate("settled", true);
	const problems: string[] = [];
	for (const step of steps) {
		const { problem } = await runStep(cdp, step, shotPath);
		if (problem) {
			problems.push(problem);
		}
	}
	await cdp.evaluate("finishSteps()");
	return problems;
}

/**
 * Packs `page` as `<name>.html` (packHtml) and runs the packed file with `runPacked`; the pack must succeed.
 */
export async function packAndRun(
	dir: ReturnType<typeof scratch>,
	name: string,
	page: string,
	options: RunOptions = {},
): Promise<string[]> {
	const output = dir.path(`${name}.out.html`);
	expect((await packHtml(dir.write(`${name}.html`, page), output)).error).toBe("");
	return runPacked(output, options);
}

/**
 * Opens a packed page in headless Chrome at each of `widths`, with reduced motion and the CPU slowed `slowdown` times
 * (1 runs at full speed), as the screen or, with `media` "print", as it prints. The page's global `contract` is a promise of the
 * failures it found, and the run waits for it, however long the page takes: a page that never settles fails on the test's
 * timeout, never by passing early. Returns those failures, the problems of any `steps` and every uncaught page error, prefixed
 * with the width; an empty list is a pass. A shot: step writes `<output without .html>-<width>-<index>.png`.
 */
export function runPacked(
	output: string,
	{ slowdown = 1, media = "screen", widths = WIDTHS, steps = [] }: RunOptions = {},
): Promise<string[]> {
	return withTestPage(async (cdp) => {
		const failures: string[] = [];
		let width = 0;
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
			failures.push(`${width}: ${(d.exception?.description ?? d.text).split("\n")[0]}`),
		);
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		if (steps.length) {
			await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: AWAIT_STEPS });
		}
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowdown });
		await cdp.send("Emulation.setEmulatedMedia", {
			media,
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		for (const viewport of widths) {
			width = viewport.width;
			await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
			// As in check: what kit:keep.js keeps from one width must not carry into the next, and the old page saves as it unloads.
			await cdp.load("about:blank");
			await cdp.send("Storage.clearDataForOrigin", {
				origin: "file://",
				storageTypes: "local_storage",
			});
			await cdp.load(`file://${output}`);
			if (steps.length) {
				const shotPath: ShotPath = (_selector, index) =>
					`${output.replace(/\.html$/, "")}-${width}-${index ?? 0}.png`;
				const problems = await runSteps(cdp, steps, shotPath);
				failures.push(...problems.map((problem) => `${width}: ${problem}`));
			}
			const found = await cdp.evaluate<string[]>("contract", true);
			failures.push(...found.map((failure) => `${width}: ${failure}`));
		}
		return failures;
	});
}

/**
 * Waits in the page for a re-render and the effects and redraws it starts: a frame, a task, another frame. The task's delay orders
 * it after the effects Preact schedules in that frame (a frame, then a task of no delay), not a time to wait for something.
 */
export const FRAMES = `new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50))).then(() => new Promise(requestAnimationFrame))`;

/**
 * Page expression: waits as check does after a load or a step (SETTLE_JS: frames, the fonts, every chart the reader can see drawn,
 * frames again) and rejects with what is still missing at its deadline, so the test fails naming it.
 */
const SETTLE = `(${SETTLE_JS}).then((missing) => { if (missing) throw new Error(missing); })`;

/** Opens `url` (or reloads, keeping storage) and waits until the page has settled (SETTLE). */
export async function load(cdp: Cdp, url?: string) {
	await cdp.load(url);
	await cdp.evaluate(SETTLE, true);
}

/**
 * Runs `action` in the page, waits for the re-render and the redraws it starts (SETTLE), and returns the page's `state` expression.
 */
export const act = <T>(cdp: Cdp, action: string, state: string) =>
	cdp.evaluate<T>(`(() => { ${action} })(), ${SETTLE}.then(() => (${state}))`, true);

/** How long `until` waits for its condition, far above any write a test waits for. */
const UNTIL_DEADLINE_MS = 3000;

/**
 * Waits, a frame at a time, until the page expression `condition` holds, and says whether it did before the deadline: for state
 * a page writes after an action settles (history, storage), which no fixed delay orders.
 */
export const until = (cdp: Cdp, condition: string) =>
	cdp.evaluate<boolean>(
		`new Promise((done) => { const end = performance.now() + ${UNTIL_DEADLINE_MS}; const poll = () => { if (${condition}) done(true); else if (performance.now() > end) done(false); else requestAnimationFrame(poll); }; poll(); })`,
		true,
	);

/**
 * Opens a packed page in headless Chrome with reduced motion, at `viewport` (default the desktop), and runs `fn`; fails on any
 * uncaught page error or console error or warning.
 */
export function inPage<T>(
	output: string,
	fn: (cdp: Cdp) => Promise<T>,
	viewport: Viewport = DESKTOP,
): Promise<T> {
	return withTestPage(async (cdp) => {
		const errors: string[] = [];
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
			errors.push(d.exception?.description ?? d.text),
		);
		cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
			if (type === "error" || type === "warning") {
				errors.push(`${type}: ${JSON.stringify(args)}`);
			}
		});
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
		await load(cdp, `file://${output}`);
		const result = await fn(cdp);
		expect(errors).toEqual([]);
		return result;
	});
}

/** The rendered diagram's SVGs: the one wide screens show, then any phone copy; fails the test when the source does not render. */
export function copiesOf(source: string): string[] {
	const diagram = renderMermaid(source);
	if (diagram instanceof Error) {
		throw diagram;
	}
	return diagram.phone ? [diagram.svg, diagram.phone] : [diagram.svg];
}

/** The rendered diagram's SVG as wide screens show it, failing the test when the source does not render. */
export const svgOf = (source: string): string => copiesOf(source)[0] ?? "";

/** The message a source fails with, or "rendered". */
export function failureOf(source: string): string {
	const diagram = renderMermaid(source);
	return diagram instanceof Error ? diagram.message : "rendered";
}
