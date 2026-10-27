import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Cdp, ChromeError, seconds, within } from "./cdp.ts";
import { cleanUpOnSignal } from "./on-signal.ts";

const { CHROME } = process.env;
const CHROME_PATHS = [
	CHROME,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/opt/homebrew/bin/chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	// Servers often have no system Chrome but do have the build a browser tool downloaded.
	...downloaded(join(homedir(), ".agent-browser/browsers"), "chrome-", "chrome"),
	...downloaded(join(homedir(), ".cache/ms-playwright"), "chromium-", "chrome-linux64/chrome"),
];

/** Chrome binaries under `dir` in folders named `<prefix><version>`, newest version first. */
function downloaded(dir: string, prefix: string, binary: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.startsWith(prefix))
		.sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
		.map((name) => join(dir, name, binary));
}

/** Waits `ms` milliseconds. For pacing that is about time itself (a recorded clip's frames); check waits on what the page draws instead. */
export const settle = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** How long Chrome may take from launch to a page ready to drive. */
const START_DEADLINE_MS = 20_000;
/** How long Chrome may take to exit after SIGTERM before it is killed, so its profile can be deleted. */
const EXIT_GRACE_MS = 5_000;
/** How often stop looks whether Chrome's helpers have exited. */
const GROUP_POLL_MS = 10;
/** How long a failed start waits to see whether Chrome is exiting on its own, whose log then explains the failure. */
const EXIT_NOTICE_MS = 1_000;

/** Chrome's flags besides the profile, the sandbox and the page it opens. */
const FLAGS = [
	"--headless=new",
	"--remote-debugging-pipe",
	"--hide-scrollbars",
	"--no-first-run",
	"--disable-gpu",
	// macOS: never touch the login keychain. Without this, Chrome asks for one on every
	// launch and shows a modal dialog when HOME has none (e.g. the sandboxed verify:install).
	"--use-mock-keychain",
	// Chrome otherwise downloads components and models (Safe Browsing lists, optimization guides, a speech engine) into
	// the profile, up to 150 MB, on the reader's network and CPU, while it only ever opens a local page.
	"--disable-background-networking",
	"--disable-component-update",
];

/** Chrome cannot create its sandbox on this host; `launch` retries without it. */
class SandboxUnavailable extends ChromeError {}

/**
 * What withPage owns of its Chrome: `stop` of the process spawned last, set as soon as it exists and resolving once it has exited,
 * and `closing`, set when cleanup begins, after which no Chrome may be spawned for the profile.
 */
interface Owner {
	stop?: () => Promise<void>;
	closing: boolean;
}

/**
 * Starts headless Chrome and resolves once its page can be driven.
 *
 * Where Chrome cannot build its sandbox (Ubuntu 23.10+ restricts the user namespaces it needs,
 * and so do most containers), Chrome exits with "No usable sandbox"; the launch is then retried
 * once without it. The tradeoff is acceptable because Chrome only ever opens a local page: the
 * one being checked, or a build script's own.
 */
async function launch(profile: string, owner: Owner, limit?: AbortSignal): Promise<Cdp> {
	const bin = CHROME_PATHS.find((p) => p && existsSync(p));
	if (!bin) {
		throw new ChromeError("no Chrome found: set CHROME=/path/to/chrome");
	}
	try {
		return await start(bin, profile, owner, [], limit);
	} catch (error) {
		if (error instanceof SandboxUnavailable) {
			return await start(bin, profile, owner, ["--no-sandbox"], limit);
		}
		throw error;
	}
}

/** Whether any process of the process group `pgid` still exists. */
function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolves once every process of Chrome's group (`pgid`, Chrome's own pid) has exited. Chrome's helpers can outlive its main
 * process by a few milliseconds and write into the profile meanwhile (on Linux a profile deleted right after the main process
 * exited came back in about one run in five), so the profile is deleted only after this. Helpers still there after EXIT_GRACE_MS
 * are killed.
 */
async function groupGone(pgid: number | undefined) {
	if (pgid === undefined) {
		return;
	}
	const end = performance.now() + EXIT_GRACE_MS;
	while (groupAlive(pgid)) {
		if (performance.now() > end) {
			process.kill(-pgid, "SIGKILL");
		}
		await settle(GROUP_POLL_MS);
	}
}

/** The last line of Chrome's log that says something, for a one-line error. */
const lastLine = (log: string) =>
	log
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1) ?? "no output";

/**
 * Spawns Chrome and attaches to a new page over the debugging pipe. The pipe is also why Chrome cannot outlive this process:
 * when it ends, however it ends (a test runner's or an agent's SIGKILL included), the pipe closes and Chrome exits, where a
 * Chrome driven over a port kept running and spun a CPU core. The process is `owner`'s from the moment it is spawned. Once
 * `limit` aborts, the start fails with its reason, and so does every later call of the returned client.
 */
async function start(
	bin: string,
	profile: string,
	owner: Owner,
	extra: string[],
	limit: AbortSignal | undefined,
): Promise<Cdp> {
	if (owner.closing) {
		throw new ChromeError("Chrome was not started: check is stopping");
	}
	limit?.throwIfAborted();
	const proc = spawn(
		bin,
		[...FLAGS, `--user-data-dir=${profile}`, ...extra, "about:blank"],
		// Chrome still adds keychain items at launch despite --use-mock-keychain, and macOS shows a
		// "Keychain Not Found" dialog when HOME has none (a sandboxed HOME, such as verify:install's).
		// The account's own home always has its keychain; the profile stays in --user-data-dir.
		// detached: Chrome and its helpers get a process group of their own, so stop can wait for every one of them, and a
		// terminal's Ctrl-C or GNU timeout's group signal reaches check alone, which then stops Chrome in order.
		{
			stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
			env: { ...process.env, HOME: userInfo().homedir },
			detached: true,
		},
	);
	let log = "";
	proc.stderr?.on("data", (d) => {
		log += d;
	});
	// Registered at once, so an exit before `stop` (a crash, or a failed start) is not missed.
	let stopping = false;
	const exited = new Promise<void>((done) => proc.once("exit", () => done()));
	const stop = async () => {
		stopping = true;
		proc.kill();
		await within(exited, EXIT_GRACE_MS, "Chrome did not exit").catch(() => {
			proc.kill("SIGKILL");
			return exited;
		});
		await groupGone(proc.pid);
	};
	owner.stop = stop;
	// Why Chrome exited on its own while starting. The full log is searched: Chrome's stack trace pushes the sandbox line out of
	// the tail.
	const exitError = () =>
		log.includes("No usable sandbox")
			? new SandboxUnavailable("Chrome has no usable sandbox")
			: new ChromeError(
					`Chrome exited before it started (code ${proc.exitCode}): ${lastLine(log)}`,
				);
	const exitedEarly = exited.then(() => {
		if (!stopping) {
			throw exitError();
		}
	});
	const cdp = new Cdp(proc.stdio[4] as Readable, proc.stdio[3] as Writable, limit);
	try {
		await within(
			Promise.race([cdp.attachPage(), exitedEarly]),
			START_DEADLINE_MS,
			`Chrome did not start in ${seconds(START_DEADLINE_MS)}`,
		);
		return cdp;
	} catch (error) {
		if (limit?.aborted) {
			await stop();
			throw error;
		}
		// The closed pipe can be reported before the exit: an exit Chrome chose (nothing has called `stop` yet) explains the
		// failure better, and decides the sandbox retry.
		const chose = await within(exited, EXIT_NOTICE_MS, "").then(
			() => true,
			() => false,
		);
		await stop();
		throw chose ? exitError() : error;
	}
}

/**
 * Deletes Chrome's profile and, on Linux, the directory Chrome keeps its process-singleton socket in: Chrome makes it in the temp
 * directory (`org.chromium.Chromium.XXXXXX`), links it from the profile's SingletonSocket, and leaves it behind whenever it exits,
 * so every run left one. Only a directory of the temp directory that this profile links to is removed.
 */
function removeProfile(profile: string) {
	try {
		const socketDir = dirname(readlinkSync(join(profile, "SingletonSocket")));
		if (realpathSync(dirname(socketDir)) === realpathSync(tmpdir())) {
			rmSync(socketDir, { recursive: true, force: true });
		}
	} catch {
		// No link (macOS, or a Chrome that never got that far), or its directory is gone already.
	}
	rmSync(profile, { recursive: true, force: true });
}

/**
 * Runs `fn` against the page of a fresh headless Chrome. Chrome is always stopped and its profile deleted once Chrome has exited
 * (a profile deleted while Chrome shuts down is written again), also when SIGINT, SIGTERM or SIGHUP ends the process, Chrome's
 * start-up included. withPage and a signal share one cleanup, which runs once. Once `limit` aborts, Chrome's start-up or the
 * page's next or pending call fails with its reason (a ChromeError), and the cleanup runs within Chrome's exit grace.
 */
export async function withPage<T>(fn: (cdp: Cdp) => Promise<T>, limit?: AbortSignal): Promise<T> {
	const profile = mkdtempSync(join(tmpdir(), "artifact-chrome-"));
	const owner: Owner = { closing: false };
	let cleaning: Promise<void> | undefined;
	const cleanup = () => {
		cleaning ??= (async () => {
			owner.closing = true;
			await owner.stop?.();
			removeProfile(profile);
		})().finally(() => release());
		return cleaning;
	};
	const release = cleanUpOnSignal(cleanup);
	try {
		const cdp = await launch(profile, owner, limit);
		try {
			await cdp.send("Inspector.enable");
			return await fn(cdp);
		} finally {
			cdp.close();
		}
	} finally {
		await cleanup();
	}
}
