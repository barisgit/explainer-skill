import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Cdp, withPage } from "../skills/explainer/src/chrome.ts";
import { renderMermaid } from "../skills/explainer/src/mermaid.ts";
import { runStep } from "../skills/explainer/src/steps.ts";

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
 * Page script that throws "<contract>: <name>" when `body` is false 300 ms after load. Each contract gets its own throw, so one
 * failure does not hide the others; check reports them as page errors. The wait is a fixed time, and a throw that comes after
 * check's shot is not reported, so a page that needs no `--do` step or `--view` load uses pageContract instead (#38).
 */
export const pageAssertion = (contract: string, name: string, body: string) =>
	`setTimeout(() => { if (!(${body})) throw new Error("${contract}: ${name}"); }, 300);`;

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
	const packed = await runCli(["pack", dir.write(`${name}.html`, page), "-o", output]);
	const checked = await runCli(["check", output, "--quick", "--out", dir.path(name), ...args]);
	expect(packed.code).toBe(0);
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

/** Navigates and waits for the load event. */
async function open(cdp: Cdp, url: string) {
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url });
	await loaded;
}

/** A window size a page runs at; `mobile` emulates a phone (touch, mobile viewport). */
export interface Viewport {
	width: number;
	height: number;
	mobile: boolean;
}

/** The widths `check` shoots, so a page run covers the same layouts. */
const WIDTHS: Viewport[] = [
	{ width: 1440, height: 900, mobile: false },
	{ width: 390, height: 844, mobile: true },
];

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

/** Runs `steps` in the open page once it has `settled`, then lets its contract go on; returns the problems the steps reported. */
async function runSteps(cdp: Cdp, steps: string[]): Promise<string[]> {
	await cdp.evaluate("settled", true);
	const problems: string[] = [];
	for (const step of steps) {
		const { problem } = await runStep(cdp, step);
		if (problem) {
			problems.push(problem);
		}
	}
	await cdp.evaluate("finishSteps()");
	return problems;
}

/**
 * Packs `page` and opens it in headless Chrome at each of `widths`, with reduced motion, the CPU slowed `slowdown` times, as the
 * screen or as it prints. The page's global `contract` is a promise of the failures it found, and the run waits for it, however long
 * the page takes: a page that never settles fails on the test's timeout, never by passing early. Returns those failures, the
 * problems of any `steps` and every uncaught page error, prefixed with the width; an empty list is a pass.
 */
export async function packAndRun(
	dir: ReturnType<typeof scratch>,
	name: string,
	page: string,
	{ slowdown = 1, media = "screen", widths = WIDTHS, steps = [] }: RunOptions = {},
): Promise<string[]> {
	const output = dir.path(`${name}.out.html`);
	const packed = await runCli(["pack", dir.write(`${name}.html`, page), "-o", output]);
	expect(packed.stderr).toBe("");
	expect(packed.code).toBe(0);
	return withPage(async (cdp) => {
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
			// As in check: what kit:reply.js keeps from one width must not carry into the next, and the old page saves as it unloads.
			await open(cdp, "about:blank");
			await cdp.send("Storage.clearDataForOrigin", {
				origin: "file://",
				storageTypes: "local_storage",
			});
			await open(cdp, `file://${output}`);
			if (steps.length) {
				failures.push(...(await runSteps(cdp, steps)).map((problem) => `${width}: ${problem}`));
			}
			const found = await cdp.evaluate<string[]>("contract", true);
			failures.push(...found.map((failure) => `${width}: ${failure}`));
		}
		return failures;
	});
}

/** The rendered diagram's SVG, failing the test when the source does not render. */
export function svgOf(source: string): string {
	const diagram = renderMermaid(source);
	if (diagram instanceof Error) {
		throw diagram;
	}
	return diagram.svg;
}

/** The message a source fails with, or "rendered". */
export function failureOf(source: string): string {
	const diagram = renderMermaid(source);
	return diagram instanceof Error ? diagram.message : "rendered";
}
