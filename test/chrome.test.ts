import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ChromeError } from "../skills/explainer/src/cdp.ts";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { SKILL_DIR, scratch } from "./support.ts";

const dir = scratch();
/** Answers no request: a page that loads from it never fires its load event, as on a stalled Chrome. */
const held = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => new Promise<Response>(() => {}) });
afterAll(() => {
	held.stop(true);
	dir.cleanup();
});

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const plain = dir.write(
	"plain.html",
	`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Plain</h1></body></html>`,
);
const stalled = dir.write(
	"stalled.html",
	`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Stalled</h1><img src="http://127.0.0.1:${held.port}/held.png"></body></html>`,
);

/** A fresh, empty temp directory for one check run, so the test sees exactly what that run leaves in it. */
function tempDir(name: string): string {
	const path = dir.path(name);
	mkdirSync(path);
	return path;
}

/** Starts `check --quick` on `file` with its temp directory at `tmp`; the caller awaits `exited`. */
const startCheck = (file: string, tmp: string, args: string[] = []) =>
	Bun.spawn(
		[
			process.execPath,
			join(SKILL_DIR, "cli.ts"),
			"check",
			file,
			"--quick",
			"--out",
			dir.path("shots"),
			...args,
		],
		{ stdout: "pipe", stderr: "pipe", env: { ...process.env, TMPDIR: tmp } },
	);

async function runCheck(file: string, tmp: string, args: string[] = []) {
	const proc = startCheck(file, tmp, args);
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

test("a page that crashes fails the call waiting on it at once, naming the crash", async () => {
	const failure = await withPage(async (cdp) => {
		void cdp.send("Page.crash").catch(() => undefined);
		return cdp.evaluate("new Promise(() => {})", true).catch((error: unknown) => error);
	});
	expect(failure).toBeInstanceOf(ChromeError);
	expect(String(failure)).toContain("the page crashed in Chrome");
}, 15_000);

test("a DevTools connection Chrome closes fails the call waiting on it at once", async () => {
	const failure = await withPage(async (cdp) => {
		void cdp.send("Page.close").catch(() => undefined);
		return cdp.evaluate("new Promise(() => {})", true).catch((error: unknown) => error);
	});
	expect(String(failure)).toContain("Chrome closed the DevTools connection");
}, 15_000);

/** Waits for `tmp`'s profile to exist, then a second more, so Chrome is running and attached when the test acts. */
async function chromeStarted(tmp: string) {
	while (!readdirSync(tmp).length) {
		await Bun.sleep(50);
	}
	await Bun.sleep(1000);
}

/** The processes whose command line names `tmp`: the Chrome a check started there, while it runs. */
const chromesIn = (tmp: string) =>
	Bun.spawnSync(["pgrep", "-f", tmp]).stdout.toString().trim().split("\n").filter(Boolean);

test("Chrome exits when the check driving it is killed, so no Chrome outlives a test timeout or an agent's kill", async () => {
	const tmp = tempDir("tmp-kill");
	const proc = startCheck(stalled, tmp);
	await chromeStarted(tmp);
	expect(chromesIn(tmp).length).toBeGreaterThan(0);
	// SIGKILL to check alone, as a test runner's timeout or an agent's kill sends it: nothing in check runs after it.
	proc.kill("SIGKILL");
	await proc.exited;
	const end = performance.now() + 5000;
	while (chromesIn(tmp).length && performance.now() < end) {
		await Bun.sleep(100);
	}
	expect(chromesIn(tmp)).toEqual([]);
}, 30_000);

test("a load that never ends stops check with one error line naming the load and the screen", async () => {
	const result = await runCheck(stalled, tempDir("tmp-stalled"));
	expect(result.code).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toBe(
		`error: the load event of file://${stalled} did not come in 10 s (at light desktop, overview)\n`,
	);
}, 30_000);

test("--timeout stops check with one error line saying where it was, and leaves no profile behind", async () => {
	const tmp = tempDir("tmp-timeout");
	const result = await runCheck(stalled, tmp, ["--timeout", "1"]);
	expect(result.code).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toBe(
		"error: check passed its 1 s limit at light desktop, overview, after 0 page(s): raise --timeout for a page with many views or --do steps\n",
	);
	expect(readdirSync(tmp)).toEqual([]);
}, 30_000);

test("check deletes its Chrome profile once Chrome has exited", async () => {
	const tmp = tempDir("tmp-plain");
	expect((await runCheck(plain, tmp)).code).toBe(0);
	expect(readdirSync(tmp)).toEqual([]);
}, 30_000);

test("check ended by SIGTERM stops Chrome and deletes its profile before it exits", async () => {
	const tmp = tempDir("tmp-term");
	const proc = startCheck(stalled, tmp);
	// The held page keeps check running until the signal.
	await chromeStarted(tmp);
	proc.kill("SIGTERM");
	expect(await proc.exited).toBe(143);
	expect(readdirSync(tmp)).toEqual([]);
}, 30_000);
