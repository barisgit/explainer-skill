import type { Readable, Writable } from "node:stream";

/**
 * How long one DevTools call may take before Chrome counts as stalled, far above any real call: the longest, check's page-side
 * waits, end themselves within 10 s and say what is still missing.
 */
const CALL_DEADLINE_MS = 20_000;
/** How long a page may take from navigation to its load event: a packed page loads nothing, so only a stalled Chrome comes close. */
const LOAD_DEADLINE_MS = 10_000;

/** A duration for an error message: `20 s`. */
export const seconds = (ms: number) => `${ms / 1000} s`;

/** Chrome could not be started or driven: an environment problem the CLI reports without a stack trace. */
export class ChromeError extends Error {}

/** The reason a call fails once Chrome has closed the pipe or the page's session. */
const CONNECTION_CLOSED = "Chrome closed the DevTools connection";

/** One call-stack entry of an exception; line and column numbers are 0-based. */
interface CallFrame {
	functionName: string;
	url: string;
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
export function within<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
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
		const closed = () => this.abort(new ChromeError(CONNECTION_CLOSED));
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
				this.abort(new ChromeError(CONNECTION_CLOSED));
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
	/** Calls `fn` on every later `event` of the page (of the browser before attachPage), for as long as the client lives. */
	on<E extends keyof CdpEvents>(event: E, fn: (params: CdpEvents[E]) => void) {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
	}
	/** Resolves on the next `event`; `what` names it in the error when it does not come within `deadline` ms. */
	private once(event: keyof CdpEvents, what: string, deadline: number): Promise<void> {
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
	/** Ends the pipe Chrome reads commands from; Chrome exits once it sees the pipe closed. */
	close() {
		this.output.end();
	}
}
