import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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

/** Waits `ms` milliseconds, for page scripts, transitions and rebuilt DOM to settle after a load or an action. */
export const settle = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

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
export interface CdpEvents {
	"Runtime.exceptionThrown": { exceptionDetails: ExceptionDetails };
	"Runtime.consoleAPICalled": { type: string; args: ConsoleArg[] };
	"Log.entryAdded": { entry: { level: string; source: string; text: string; url?: string } };
	"Network.requestWillBeSent": { request: { url: string } };
	"Network.loadingFailed": { errorText: string; canceled?: boolean };
	"Page.loadEventFired": object;
}

type Reply = { result?: unknown; error?: { message: string } };
type Message = Reply & { id?: number; method?: keyof CdpEvents; params?: unknown };

/** Minimal Chrome DevTools Protocol client: request/response plus event subscription. */
export class Cdp {
	private id = 0;
	private readonly pending = new Map<number, (r: Reply) => void>();
	private readonly listeners = new Map<string, Array<(params: never) => void>>();
	private readonly ws: WebSocket;
	private constructor(ws: WebSocket) {
		this.ws = ws;
		ws.onmessage = (m) => {
			const msg = JSON.parse(String(m.data)) as Message;
			if (msg.id) {
				this.pending.get(msg.id)?.(msg);
			} else if (msg.method) {
				for (const listener of this.listeners.get(msg.method) ?? []) {
					listener(msg.params as never);
				}
			}
		};
	}
	static async connect(url: string): Promise<Cdp> {
		const ws = new WebSocket(url);
		await new Promise((ok, fail) => {
			ws.onopen = ok;
			ws.onerror = () => fail(new ChromeError("cannot connect to Chrome"));
		});
		return new Cdp(ws);
	}
	/** Sends a command; `T` is the caller's description of the reply, which the protocol does not let us check. */
	send<T = unknown>(method: string, params: object = {}): Promise<T> {
		const id = ++this.id;
		return new Promise((ok, fail) => {
			this.pending.set(id, (r) =>
				r.error ? fail(new Error(`${method}: ${r.error.message}`)) : ok(r.result as T),
			);
			this.ws.send(JSON.stringify({ id, method, params }));
		});
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
	once(event: keyof CdpEvents): Promise<void> {
		return new Promise((ok) => this.on(event, () => ok()));
	}
	close() {
		this.ws.close();
	}
}

/**
 * Starts headless Chrome and resolves with its DevTools HTTP port.
 *
 * Where Chrome cannot build its sandbox (Ubuntu 23.10+ restricts the user namespaces it needs,
 * and so do most containers), Chrome exits with "No usable sandbox"; the launch is then retried
 * once without it. The tradeoff is acceptable because Chrome only ever opens the local page
 * being packed or checked.
 */
export async function launch(profile: string): Promise<{ port: number; stop: () => void }> {
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

async function start(
	bin: string,
	profile: string,
	extra: string[],
): Promise<{ port: number; stop: () => void }> {
	const proc = spawn(
		bin,
		[
			"--headless=new",
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			"--hide-scrollbars",
			"--no-first-run",
			"--disable-gpu",
			...extra,
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	const port = await new Promise<number>((ok, fail) => {
		let log = "";
		proc.stderr.on("data", (d) => {
			log += d;
			const m = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
			if (m) {
				ok(Number(m[1]));
			}
		});
		// The full log is searched: Chrome's stack trace pushes the sandbox line out of the tail.
		proc.on("exit", () =>
			fail(
				log.includes("No usable sandbox")
					? new SandboxUnavailable("Chrome has no usable sandbox")
					: new ChromeError(`Chrome exited early:\n${log.slice(-400)}`),
			),
		);
	});
	return { port, stop: () => proc.kill() };
}

/**
 * The DevTools URL of Chrome's first page. Chrome announces its port before it registers the page,
 * by about 200 ms on a slow Linux host, so the list is polled for up to five seconds.
 */
async function firstPage(port: number): Promise<string> {
	for (let tries = 0; tries < 50; tries++) {
		const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
			(r) => r.json() as Promise<Array<{ type: string; webSocketDebuggerUrl: string }>>,
		);
		const page = targets.find((t) => t.type === "page");
		if (page) {
			return page.webSocketDebuggerUrl;
		}
		await settle(100);
	}
	throw new ChromeError("Chrome opened no page to drive");
}

/** Runs `fn` against the page of a fresh headless Chrome; Chrome and its profile are always cleaned up. */
export async function withPage<T>(fn: (cdp: Cdp) => Promise<T>): Promise<T> {
	const profile = mkdtempSync(join(tmpdir(), "artifact-chrome-"));
	const chrome = await launch(profile);
	try {
		const cdp = await Cdp.connect(await firstPage(chrome.port));
		try {
			return await fn(cdp);
		} finally {
			cdp.close();
		}
	} finally {
		chrome.stop();
		rmSync(profile, { recursive: true, force: true });
	}
}
