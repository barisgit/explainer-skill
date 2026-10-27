import { afterAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { constants } from "node:os";
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
const stalled = dir.write(
	"stalled.html",
	`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Stalled</h1><img src="http://127.0.0.1:${held.port}/held.png"></body></html>`,
);
/** Loads at once but on a narrow screen holds a reload: check captures the desktop, then stalls in the narrow screen's --do reload. */
const stalledReload = dir.write(
	"stalled-reload.html",
	`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Stalled reload</h1><script>
if (performance.getEntriesByType("navigation")[0].type === "reload" && innerWidth < 600) document.write('<img src="http://127.0.0.1:${held.port}/held.png">');
</script></body></html>`,
);

/** A fresh, empty temp directory for one check run, so the test sees exactly what that run leaves in it. */
function tempDir(name: string): string {
	const path = dir.path(name);
	mkdirSync(path);
	return path;
}

/**
 * An executable that runs test/fake-chrome.ts, for CHROME: a Chrome whose start-up and shutdown the test controls. FAKE_CHROME
 * "silent" makes it never answer, as a Chrome that hangs while it starts.
 */
const fakeChrome = dir.write(
	"fake-chrome",
	`#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "fake-chrome.ts")}" "$@"\n`,
);
chmodSync(fakeChrome, 0o755);

/** Starts `check --quick` on `file` with its temp directory at `tmp` and `env` added; the caller awaits `exited`. */
const startCheck = (file: string, tmp: string, args: string[] = [], env: object = {}) =>
	Bun.spawn(
		[
			process.execPath,
			join(SKILL_DIR, "cli.ts"),
			"check",
			file,
			"--quick",
			...(args.includes("--out") ? [] : ["--out", dir.path("shots")]),
			...args,
		],
		{ stdout: "pipe", stderr: "pipe", env: { ...process.env, TMPDIR: tmp, ...env } },
	);

async function runCheck(file: string, tmp: string, args: string[] = [], env: object = {}) {
	const proc = startCheck(file, tmp, args, env);
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

/** Waits up to 5 s for every Chrome started in `tmp` to exit, so what the test sees next includes all they wrote. */
async function chromesGone(tmp: string) {
	const end = performance.now() + 5000;
	while (chromesIn(tmp).length && performance.now() < end) {
		await Bun.sleep(100);
	}
	expect(chromesIn(tmp)).toEqual([]);
}

test("Chrome exits when the check driving it is killed, so no Chrome outlives a test timeout or an agent's kill", async () => {
	const tmp = tempDir("tmp-kill");
	const proc = startCheck(stalled, tmp);
	await chromeStarted(tmp);
	expect(chromesIn(tmp).length).toBeGreaterThan(0);
	// SIGKILL to check alone, as a test runner's timeout or an agent's kill sends it: nothing in check runs after it.
	proc.kill("SIGKILL");
	await proc.exited;
	await chromesGone(tmp);
}, 30_000);

test("a load that never ends stops check with one error line naming the screen and the --do step it was in, and writes no PNG", async () => {
	// The desktop is captured before the narrow screen stalls. Its PNG has the name of a file already in --out, which must keep
	// what it had, as must the other file there.
	const out = tempDir("out-stalled");
	writeFileSync(join(out, "desktop.png"), "before");
	writeFileSync(join(out, "notes.txt"), "mine");
	const result = await runCheck(stalledReload, tempDir("tmp-stalled"), [
		"--do",
		"reload",
		"--out",
		out,
	]);
	expect(result.code).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toBe(
		"error: the load event after a reload did not come in 10 s (at light narrow, overview, --do step 1: reload)\n",
	);
	expect(readdirSync(out).sort()).toEqual(["desktop.png", "notes.txt"]);
	expect(readFileSync(join(out, "desktop.png"), "utf8")).toBe("before");
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

test("--timeout counts Chrome's start-up: a Chrome that hangs while it starts stops check at the limit", async () => {
	const tmp = tempDir("tmp-timeout-start");
	const started = performance.now();
	const result = await runCheck(stalled, tmp, ["--timeout", "1"], {
		CHROME: fakeChrome,
		FAKE_CHROME: "silent",
	});
	expect(result.stderr).toBe(
		"error: check passed its 1 s limit while starting Chrome, after 0 page(s): raise --timeout for a page with many views or --do steps\n",
	);
	expect(result.code).toBe(1);
	// The limit plus the stand-in's shutdown, far below the 20 s start-up deadline.
	expect(performance.now() - started).toBeLessThan(10_000);
	await chromesGone(tmp);
	expect(readdirSync(tmp)).toEqual([]);
}, 30_000);

test("withPage deletes Chrome's profile only once Chrome has exited, so nothing Chrome writes as it shuts down is left", async () => {
	const tmp = tempDir("tmp-exit-write");
	const chrome = join(import.meta.dir, "..", "skills", "explainer", "src", "chrome.ts");
	const proc = Bun.spawn(
		[
			process.execPath,
			"-e",
			`await (await import(${JSON.stringify(chrome)})).withPage(async () => {});`,
		],
		{ env: { ...process.env, CHROME: fakeChrome, TMPDIR: tmp } },
	);
	expect(await proc.exited).toBe(0);
	await chromesGone(tmp);
	expect(readdirSync(tmp)).toEqual([]);
}, 30_000);

test("withPage removes no directory but Chrome's own singleton directory, whatever path the profile's link spells", async () => {
	const outer = tempDir("tmp-dotdot");
	const job = join(outer, "job");
	mkdirSync(job);
	writeFileSync(join(outer, "kept"), "");
	const chrome = join(import.meta.dir, "..", "skills", "explainer", "src", "chrome.ts");
	// The link's directory, spelled job/.., is the temp directory's parent: removing it would remove the temp directory too.
	const proc = Bun.spawn(
		[
			process.execPath,
			"-e",
			`await (await import(${JSON.stringify(chrome)})).withPage(async () => {});`,
		],
		{
			env: {
				...process.env,
				CHROME: fakeChrome,
				TMPDIR: job,
				FAKE_SINGLETON: `${job}/../SingletonSocket`,
			},
		},
	);
	expect(await proc.exited).toBe(0);
	await chromesGone(outer);
	// The stand-in's socket stays: it lies outside the temp directory, which is all cleanup may touch.
	expect(readdirSync(outer).sort()).toEqual(["SingletonSocket", "job", "kept"]);
	expect(readdirSync(job)).toEqual([]);
}, 30_000);

test("withPage whose Chrome leaves a process that never exits kills its group once, keeps the profile and says where, within a bound", async () => {
	const tmp = tempDir("tmp-stuck");
	const chrome = join(import.meta.dir, "..", "skills", "explainer", "src", "chrome.ts");
	// A zombie helper (adopted by a PID 1 that does not reap) stays in Chrome's group after SIGKILL: here the group probe says
	// so, while every real signal still goes through.
	const script = `
		const kill = process.kill.bind(process);
		let groupKills = 0;
		process.kill = (pid, signal) => {
			if (pid < 0 && signal === 0) return true;
			if (pid < 0 && signal === "SIGKILL") groupKills++;
			return kill(pid, signal);
		};
		await (await import(${JSON.stringify(chrome)})).withPage(async () => {});
		console.log(groupKills);
	`;
	const started = performance.now();
	const proc = Bun.spawn([process.execPath, "-e", script], {
		env: { ...process.env, CHROME: fakeChrome, TMPDIR: tmp },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(await proc.exited).toBe(0);
	// Chrome's 5 s exit grace is not needed here (the stand-in exits on SIGTERM), so this is the helpers' grace and the kill's.
	expect(performance.now() - started).toBeLessThan(5_000);
	expect(await new Response(proc.stdout).text()).toBe("1\n");
	const profile = readdirSync(tmp).find((name) => name.startsWith("artifact-chrome-"));
	expect(await new Response(proc.stderr).text()).toBe(
		`warning: Chrome's processes did not all exit, so its profile is kept: ${join(tmp, profile ?? "")}\n`,
	);
	expect(existsSync(join(tmp, profile ?? "", "started"))).toBe(true);
	await chromesGone(tmp);
}, 30_000);

test("check ended by SIGTERM while Chrome starts stops that Chrome and deletes its profile after it exits", async () => {
	const tmp = tempDir("tmp-term-start");
	const proc = startCheck(stalled, tmp, [], { CHROME: fakeChrome, FAKE_CHROME: "silent" });
	while (!readdirSync(tmp).some((profile) => existsSync(join(tmp, profile, "started")))) {
		await Bun.sleep(20);
	}
	proc.kill("SIGTERM");
	expect(await proc.exited).toBe(143);
	await chromesGone(tmp);
	expect(readdirSync(tmp)).toEqual([]);
}, 30_000);

test("check ended by SIGTERM stops Chrome and deletes its profile and unfinished shots before it exits", async () => {
	const tmp = tempDir("tmp-term");
	const out = tempDir("out-term");
	const proc = startCheck(stalled, tmp, ["--out", out]);
	// The held page keeps check running until the signal.
	await chromeStarted(tmp);
	proc.kill("SIGTERM");
	expect(await proc.exited).toBe(143);
	expect(readdirSync(tmp)).toEqual([]);
	expect(readdirSync(out)).toEqual([]);
}, 30_000);

/**
 * Starts `check --quick` on the stalled page with the stand-in Chrome, as the leader of its own process group so the test can
 * signal check and its Chrome together, as a terminal's Ctrl-C or GNU timeout does. Resolves once the stand-in runs, with check's
 * exit (its code, or 128 + the signal that killed it) and stderr.
 */
async function startGroup(tmp: string, out: string) {
	const proc = spawn(
		process.execPath,
		[join(SKILL_DIR, "cli.ts"), "check", stalled, "--quick", "--out", out],
		{
			detached: true,
			stdio: ["ignore", "ignore", "pipe"],
			env: { ...process.env, TMPDIR: tmp, CHROME: fakeChrome },
		},
	);
	let stderr = "";
	proc.stderr?.on("data", (d) => {
		stderr += d;
	});
	const exited = new Promise<{ code: number; stderr: string }>((done) =>
		proc.once("exit", (code, signal) =>
			done({ code: code ?? 128 + (signal ? constants.signals[signal] : 0), stderr }),
		),
	);
	while (!readdirSync(tmp).some((profile) => existsSync(join(tmp, profile, "started")))) {
		await Bun.sleep(20);
	}
	return { pid: proc.pid ?? 0, exited };
}

test("check and its Chrome ended by one signal, which check gets twice as GNU timeout sends it, still remove the profile and unfinished shots", async () => {
	const tmp = tempDir("tmp-group");
	const out = tempDir("out-group");
	const { pid, exited } = await startGroup(tmp, out);
	// GNU timeout signals its child, then the child's process group: check gets SIGTERM twice, the second while it is still
	// waiting for its Chrome to exit. Chrome runs in a group of its own, so it gets the signal only from a kill sent to every
	// process involved, as here.
	process.kill(pid, "SIGTERM");
	for (const chrome of chromesIn(tmp)) {
		process.kill(Number(chrome), "SIGTERM");
	}
	await Bun.sleep(100);
	process.kill(-pid, "SIGTERM");
	expect(await exited).toEqual({ code: 143, stderr: "" });
	await chromesGone(tmp);
	expect(readdirSync(tmp)).toEqual([]);
	expect(readdirSync(out)).toEqual([]);
}, 30_000);

test("check whose Chrome exits before check handles its signal still removes the profile and unfinished shots", async () => {
	const tmp = tempDir("tmp-chrome-first");
	const out = tempDir("out-chrome-first");
	const { pid, exited } = await startGroup(tmp, out);
	for (const chrome of chromesIn(tmp)) {
		process.kill(Number(chrome), "SIGKILL");
	}
	process.kill(pid, "SIGTERM");
	// Either the signal or Chrome's lost connection ends check first; neither may leave a file behind.
	expect([1, 143]).toContain((await exited).code);
	await chromesGone(tmp);
	expect(readdirSync(tmp)).toEqual([]);
	expect(readdirSync(out)).toEqual([]);
}, 30_000);
