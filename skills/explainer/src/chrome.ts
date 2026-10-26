import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { constants, homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

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

/**
 * How long one DevTools call may take before Chrome counts as stalled, far above any real call: the longest, check's page-side
 * waits, end themselves within 10 s and say what is still missing.
 */
const CALL_DEADLINE_MS = 20_000;
/** How long a page may take from navigation to its load event: a packed page loads nothing, so only a stalled Chrome comes close. */
const LOAD_DEADLINE_MS = 10_000;
/** How long Chrome may take from launch to a page ready to drive. */
const START_DEADLINE_MS = 20_000;
/** How long Chrome may take to exit after SIGTERM before it is killed, so its profile can be deleted. */
const EXIT_GRACE_MS = 5_000;
/** How long a failed start waits to see whether Chrome is exiting on its own, whose log then explains the failure. */
const EXIT_NOTICE_MS = 1_000;

const seconds = (ms: number) => `${ms / 1000} s`;

/** Chrome could not be started or driven: an environment problem the CLI reports without a stack trace. */
export class ChromeError extends Error {}

/** Chrome cannot create its sandbox on this host; `launch` retries without it. */
class SandboxUnavailable extends ChromeError {}

/** One call-stack entry of an exception; line and column numbers are 0-based. */
interface CallFrame {
	functionName: string;
	lineNumber: number;
	columnNumber: number;
}

/** Details of a script exception as the DevTools Protocol reports it; `lineNumber` and `columnNumber` (0-based) are where it was thrown. */
export interface ExceptionDetails {
	text: string;
	lineNumber: number;
	columnNumber: number;
	exception?: { description?: string };
	stackTrace?: { callFrames: CallFrame[] };
}

/** A console argument as `Runtime.consoleAPICalled` reports it. */
interface ConsoleArg {
	value?: unknown;
	description?: string;
}

/** The DevTools events the tool listens for, with the parts of their parameters it reads. */
interface CdpEvents {
	"Runtime.exceptionThrown": { exceptionDetails: ExceptionDetails };
	"Runtime.consoleAPICalled": { type: string; args: ConsoleArg[] };
	"Log.entryAdded": { entry: { level: string; source: string; text: string; url?: string } };
	"Network.requestWillBeSent": { request: { url: string } };
	"Network.loadingFailed": { errorText: string; canceled?: boolean };
	"Page.loadEventFired": object;
	"Inspector.targetCrashed": object;
	"Target.detachedFromTarget": { sessionId: string };
}

type Reply = { result?: unknown; error?: { message: string } };
type Message = Reply & {
	id?: number;
	method?: keyof CdpEvents;
	params?: unknown;
	sessionId?: string;
};

/** A promise that rejects with ChromeError(`message`) unless `work` settles within `ms`; the timer never outlives the work. */
function within<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, fail) => {
		timer = setTimeout(() => fail(new ChromeError(message)), ms);
	});
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Minimal Chrome DevTools Protocol client over Chrome's debugging pipe (`--remote-debugging-pipe`: JSON messages ended by a NUL
 * byte, written to Chrome's fd 3 and read from its fd 4): request/response plus event subscription. It starts on the browser
 * target, and `attachPage` then points every call and event at one page. Every call and awaited event has a deadline, and once
 * the connection is lost (Chrome exited, the page crashed or closed, or `abort` was called) every pending and later call fails
 * with that reason instead of waiting forever.
 */
export class Cdp {
	private id = 0;
	private readonly pending = new Map<number, (r: Reply) => void>();
	private readonly listeners = new Map<string, Array<(params: never) => void>>();
	/** Rejecters of the calls and events being awaited, called with the reason the connection is lost. */
	private readonly waiters = new Set<(error: ChromeError) => void>();
	private lost: ChromeError | undefined;
	/** The page's session once attachPage has run; until then calls go to the browser. */
	private sessionId: string | undefined;
	private readonly output: Writable;
	constructor(input: Readable, output: Writable) {
		this.output = output;
		const closed = () => this.abort(new ChromeError("Chrome closed the DevTools connection"));
		output.on("error", closed);
		input.on("error", closed).on("close", closed);
		input.setEncoding("utf8");
		// A message can span chunks (a screenshot is megabytes), so only each new chunk is searched for the end byte.
		let parts: string[] = [];
		input.on("data", (chunk: string) => {
			const messages = chunk.split("\0");
			const last = messages.pop() ?? "";
			for (const text of messages) {
				this.receive(JSON.parse(parts.join("") + text) as Message);
				parts = [];
			}
			parts.push(last);
		});
		this.on("Inspector.targetCrashed", () =>
			this.abort(
				new ChromeError("the page crashed in Chrome (out of memory, or its process was killed)"),
			),
		);
	}
	private receive(msg: Message) {
		if (msg.id) {
			this.pending.get(msg.id)?.(msg);
		} else if (msg.method === "Target.detachedFromTarget") {
			if ((msg.params as CdpEvents["Target.detachedFromTarget"]).sessionId === this.sessionId) {
				this.abort(new ChromeError("Chrome closed the DevTools connection"));
			}
		} else if (msg.method && msg.sessionId === this.sessionId) {
			for (const listener of this.listeners.get(msg.method) ?? []) {
				listener(msg.params as never);
			}
		}
	}
	/** Opens a new page and directs every later call and event to it. */
	async attachPage() {
		const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", {
			url: "about:blank",
		});
		const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		this.sessionId = sessionId;
	}
	/**
	 * Fails every pending and later call and awaited event with `error`: for a caller whose own deadline has passed. The first
	 * reason wins, so a later close does not replace it.
	 */
	abort(error: ChromeError) {
		if (this.lost) {
			return;
		}
		this.lost = error;
		for (const fail of this.waiters) {
			fail(error);
		}
		this.waiters.clear();
	}
	/** Runs `start` and waits for what it resolves through `ok`, failing on the deadline or a lost connection. */
	private wait<T>(
		message: string,
		ms: number,
		start: (ok: (value: T) => void, fail: (error: Error) => void) => () => void,
	): Promise<T> {
		if (this.lost) {
			return Promise.reject(this.lost);
		}
		let fail: (error: Error) => void = () => undefined;
		let stop: () => void = () => undefined;
		const work = new Promise<T>((ok, failed) => {
			fail = failed;
			stop = start(ok, failed);
		});
		this.waiters.add(fail);
		return within(work, ms, message).finally(() => {
			this.waiters.delete(fail);
			stop();
		});
	}
	/**
	 * Sends a command and waits at most `deadline` ms for its reply; `T` is the caller's description of the reply, which the protocol
	 * does not let us check. A protocol error is a ChromeError naming the method.
	 */
	send<T = unknown>(method: string, params: object = {}, deadline = CALL_DEADLINE_MS): Promise<T> {
		const id = ++this.id;
		return this.wait<T>(
			`Chrome did not answer ${method} in ${seconds(deadline)}`,
			deadline,
			(ok, fail) => {
				this.pending.set(id, (r) =>
					r.error ? fail(new ChromeError(`${method}: ${r.error.message}`)) : ok(r.result as T),
				);
				const { sessionId } = this;
				this.output.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
				return () => this.pending.delete(id);
			},
		);
	}
	/** Evaluates `expression` in the page and returns its JSON value; throws with the page's error when the script throws. */
	async evaluate<T>(expression: string, awaitPromise = false): Promise<T> {
		const { result, exceptionDetails } = await this.send<{
			result: { value: T };
			exceptionDetails?: ExceptionDetails;
		}>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
		if (exceptionDetails) {
			throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
		}
		return result.value;
	}
	on<E extends keyof CdpEvents>(event: E, fn: (params: CdpEvents[E]) => void) {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
	}
	/** Resolves on the next `event`; `what` names it in the error when it does not come within `deadline` ms. */
	once(event: keyof CdpEvents, what: string = event, deadline = CALL_DEADLINE_MS): Promise<void> {
		return this.wait<void>(`${what} did not come in ${seconds(deadline)}`, deadline, (ok) => {
			const listener = () => ok();
			this.on(event, listener);
			return () => this.off(event, listener);
		});
	}
	private off(event: keyof CdpEvents, fn: () => void) {
		this.listeners.set(
			event,
			(this.listeners.get(event) ?? []).filter((listener) => listener !== fn),
		);
	}
	/**
	 * Opens `url` in the page, or reloads it when `url` is undefined, and waits for its load event. Fails when Chrome refuses the
	 * navigation, or the load event does not come within LOAD_DEADLINE_MS.
	 */
	async load(url?: string): Promise<void> {
		const what = url ? `the load event of ${url}` : "the load event after a reload";
		const loaded = this.once("Page.loadEventFired", what, LOAD_DEADLINE_MS);
		// The navigation may fail first; the load wait then fails too, and must not surface as an unhandled rejection.
		loaded.catch(() => undefined);
		if (url) {
			const { errorText } = await this.send<{ errorText?: string }>("Page.navigate", { url });
			if (errorText) {
				throw new ChromeError(`Chrome could not open ${url}: ${errorText}`);
			}
		} else {
			await this.send("Page.reload");
		}
		await loaded;
	}
	close() {
		this.output.end();
	}
}

/** A running Chrome: the client attached to its page, and `stop`, which resolves once the process has exited. */
interface Chrome {
	cdp: Cdp;
	stop: () => Promise<void>;
}

/**
 * Starts headless Chrome and resolves once its page can be driven.
 *
 * Where Chrome cannot build its sandbox (Ubuntu 23.10+ restricts the user namespaces it needs,
 * and so do most containers), Chrome exits with "No usable sandbox"; the launch is then retried
 * once without it. The tradeoff is acceptable because Chrome only ever opens a local page: the
 * one being checked, or a build script's own.
 */
async function launch(profile: string): Promise<Chrome> {
	const bin = CHROME_PATHS.find((p) => p && existsSync(p));
	if (!bin) {
		throw new ChromeError("no Chrome found: set CHROME=/path/to/chrome");
	}
	try {
		return await start(bin, profile, []);
	} catch (error) {
		if (error instanceof SandboxUnavailable) {
			return await start(bin, profile, ["--no-sandbox"]);
		}
		throw error;
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
 * Chrome driven over a port kept running and spun a CPU core.
 */
async function start(bin: string, profile: string, extra: string[]): Promise<Chrome> {
	const proc = spawn(
		bin,
		[
			"--headless=new",
			"--remote-debugging-pipe",
			`--user-data-dir=${profile}`,
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
			...extra,
			"about:blank",
		],
		// Chrome still adds keychain items at launch despite --use-mock-keychain, and macOS shows a
		// "Keychain Not Found" dialog when HOME has none (a sandboxed HOME, such as verify:install's).
		// The account's own home always has its keychain; the profile stays in --user-data-dir.
		{
			stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
			env: { ...process.env, HOME: userInfo().homedir },
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
	};
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
	const cdp = new Cdp(proc.stdio[4] as Readable, proc.stdio[3] as Writable);
	try {
		await within(
			Promise.race([cdp.attachPage(), exitedEarly]),
			START_DEADLINE_MS,
			`Chrome did not start in ${seconds(START_DEADLINE_MS)}`,
		);
		return { cdp, stop };
	} catch (error) {
		// The closed pipe can be reported before the exit: an exit Chrome chose explains the failure better, and decides the
		// sandbox retry.
		const chose =
			!stopping &&
			(await within(exited, EXIT_NOTICE_MS, "").then(
				() => true,
				() => false,
			));
		await stop();
		throw chose ? exitError() : error;
	}
}

/** The cleanups of the Chromes running now, so a signal that ends the process removes them and their profiles too. */
const running = new Set<() => Promise<void>>();

/** Stops every running Chrome and deletes its profile, then exits as the signal would have. */
function exitOnSignal(signal: NodeJS.Signals) {
	void Promise.allSettled([...running].map((cleanup) => cleanup())).finally(() =>
		process.exit(128 + (constants.signals[signal] ?? 0)),
	);
}

let signalsHooked = false;
function hookSignals() {
	if (signalsHooked) {
		return;
	}
	signalsHooked = true;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.once(signal, exitOnSignal);
	}
}

/**
 * Runs `fn` against the page of a fresh headless Chrome. Chrome is always stopped and its profile deleted once Chrome has exited
 * (a profile deleted while Chrome shuts down is written again), also when SIGINT, SIGTERM or SIGHUP ends the process.
 */
export async function withPage<T>(fn: (cdp: Cdp) => Promise<T>): Promise<T> {
	const profile = mkdtempSync(join(tmpdir(), "artifact-chrome-"));
	let chrome: Chrome | undefined;
	const cleanup = async () => {
		await chrome?.stop();
		rmSync(profile, { recursive: true, force: true });
	};
	running.add(cleanup);
	hookSignals();
	try {
		chrome = await launch(profile);
		const { cdp } = chrome;
		try {
			await cdp.send("Inspector.enable");
			return await fn(cdp);
		} finally {
			cdp.close();
		}
	} finally {
		running.delete(cleanup);
		await cleanup();
	}
}
