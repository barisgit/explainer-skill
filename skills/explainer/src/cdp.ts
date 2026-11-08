import type { Readable, Writable } from "node:stream";

/**
 * How long one DevTools call may take before Chrome counts as stalled, far above any real call: the longest, check's page-side
 * waits, end themselves within 10 s and say what is still missing.
 */
const CALL_DEADLINE_MS = 20_000;
/** How long a page may take from navigation to its load event: a packed page loads nothing, so only a stalled Chrome comes close. */
const LOAD_DEADLINE_MS = 10_000;

/** Maximum disposal wait for a temporary target/context; callers reserve this inside their total budget. */
export const DISPOSE_DEADLINE_MS = 2_000;

/** A duration for an error message: `20 s`. */
export const seconds = (ms: number) => `${ms / 1000} s`;

/** Chrome could not be started or driven: an environment problem the CLI reports without a stack trace. */
export class ChromeError extends Error {}

/** The reason a call fails once Chrome has closed the pipe or the page's session. */
const CONNECTION_CLOSED = "Chrome closed the DevTools connection";

/** Preserves a caller's timeout identity while normalizing other abort reasons to Chrome failures. */
const abortError = (reason: unknown): ChromeError =>
	reason instanceof ChromeError ? reason : new ChromeError(String(reason));

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
	"Runtime.bindingCalled": { name: string; payload: string };
	"Log.entryAdded": { entry: { level: string; source: string; text: string; url?: string } };
	"Network.requestWillBeSent": { request: { url: string } };
	"Network.loadingFailed": { errorText: string; canceled?: boolean };
	"Page.loadEventFired": object;
	"Page.frameNavigated": {
		frame: { id: string; url: string; loaderId: string; parentId?: string };
	};
	"Debugger.paused": object;
	"Inspector.targetCrashed": object;
	"Target.detachedFromTarget": { sessionId: string };
	"Target.targetDestroyed": { targetId: string };
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
 * What the clients of one debugging pipe share: the pipe Chrome reads commands from, the call numbers, the replies being awaited
 * and the clients that events are routed to by session.
 */
class Wire {
	private id = 0;
	readonly pending = new Map<number, (r: Reply) => void>();
	readonly clients = new Set<Cdp>();
	/** Why the connection is lost, once it is. */
	lost: ChromeError | undefined;
	readonly output: Writable;
	constructor(output: Writable) {
		this.output = output;
	}
	/** Sends a call for `sessionId` and returns its number. */
	write(method: string, params: object, sessionId: string | undefined): number {
		const id = ++this.id;
		this.output.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
		return id;
	}
	/** Hands a reply to its call, and an event to the clients of its session (the browser's have none). */
	receive(msg: Message) {
		if (msg.id) {
			this.pending.get(msg.id)?.(msg);
		} else if (msg.method === "Target.detachedFromTarget") {
			const { sessionId } = msg.params as CdpEvents["Target.detachedFromTarget"];
			for (const client of this.clients) {
				if (client.sessionId === sessionId) {
					client.abort(new ChromeError(CONNECTION_CLOSED));
				}
			}
		} else if (msg.method) {
			for (const client of this.clients) {
				if (client.sessionId === msg.sessionId) {
					client.emit(msg.method, msg.params as never);
				}
			}
		}
	}
	/** Fails every client: Chrome exited, the pipe broke or the caller's limit passed. The first reason wins. */
	abort(error: ChromeError) {
		this.lost ??= error;
		for (const client of this.clients) {
			client.abort(error);
		}
	}
}

/**
 * Minimal Chrome DevTools Protocol client over Chrome's debugging pipe (`--remote-debugging-pipe`: JSON messages ended by a NUL
 * byte, written to Chrome's fd 3 and read from its fd 4): request/response plus event subscription. `open` returns the client of
 * the browser target; its `page` and `isolatedPage` run a function against a new page with a client of that page (its calls and
 * events are the page's). Every call and awaited event has a deadline,
 * and once the connection is lost (Chrome exited, a page crashed or closed, `abort` was called or the caller's limit passed)
 * every pending and later call of the clients it concerns fails with that reason instead of waiting forever.
 */
export class Cdp {
	private readonly listeners = new Map<string, Array<(params: never) => void>>();
	/** Rejecters of the calls and events being awaited, called with the reason the connection is lost. */
	private readonly waiters = new Set<(error: ChromeError) => void>();
	private lost: ChromeError | undefined;
	private readonly wire: Wire;
	/** The page's session; undefined for the browser's client. */
	readonly sessionId: string | undefined;
	private constructor(wire: Wire, sessionId: string | undefined) {
		this.wire = wire;
		this.sessionId = sessionId;
		wire.clients.add(this);
		if (wire.lost) {
			this.abort(wire.lost);
		}
		this.on("Inspector.targetCrashed", () =>
			this.abort(
				new ChromeError("the page crashed in Chrome (out of memory, or its process was killed)"),
			),
		);
	}
	/**
	 * The client of the browser behind `input` and `output` (Chrome's fd 4 and fd 3). `limit`, when given, aborts every client
	 * with its reason, which must then be a ChromeError.
	 */
	static open(input: Readable, output: Writable, limit?: AbortSignal): Cdp {
		const wire = new Wire(output);
		const browser = new Cdp(wire, undefined);
		const stop = () => wire.abort(abortError(limit?.reason));
		if (limit?.aborted) {
			stop();
		}
		limit?.addEventListener("abort", stop, { once: true });
		const closed = () => wire.abort(new ChromeError(CONNECTION_CLOSED));
		output.on("error", closed);
		input.on("error", closed).on("close", closed);
		input.setEncoding("utf8");
		// A message can span chunks (a screenshot is megabytes), so only each new chunk is searched for the end byte.
		let parts: string[] = [];
		input.on("data", (chunk: string) => {
			const messages = chunk.split("\0");
			const last = messages.pop() ?? "";
			for (const text of messages) {
				wire.receive(JSON.parse(parts.join("") + text) as Message);
				parts = [];
			}
			parts.push(last);
		});
		return browser;
	}
	/** Calls the listeners of `event`; the connection's, which routes events here by session. */
	emit<E extends keyof CdpEvents>(event: E, params: CdpEvents[E]) {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(params as never);
		}
	}
	/**
	 * Runs `fn` against a new page, with a client of it, in the browser's default context. Called on the browser's client. The page
	 * lives until the browser does: a Chrome ended while a page in a context of its own has a request in flight spins on instead
	 * of exiting when its pipe closes, which a killed `check` must not leave behind.
	 */
	async page<T>(fn: (cdp: Cdp) => Promise<T>): Promise<T> {
		return await this.attach(fn, undefined);
	}
	/**
	 * Runs `fn` against a new page in a browser context of its own, which is disposed afterwards with the page, so pages that
	 * share a browser share no cookies, storage or tabs. Called on the browser's client.
	 */
	async isolatedPage<T>(fn: (cdp: Cdp) => Promise<T>): Promise<T> {
		const { browserContextId } = await this.send<{ browserContextId: string }>(
			"Target.createBrowserContext",
		);
		try {
			return await this.attach(fn, browserContextId);
		} finally {
			// Best effort and short: a Chrome that no longer answers is being stopped anyway.
			await this.send(
				"Target.disposeBrowserContext",
				{ browserContextId },
				DISPOSE_DEADLINE_MS,
			).catch(() => undefined);
		}
	}
	/** A disposable default-context page: abort only its work, reconcile acquisition, and confirm target destruction. */
	async temporaryPage<T>(fn: (cdp: Cdp) => Promise<T>, signal: AbortSignal): Promise<T> {
		const scoped = new Cdp(this.wire, undefined);
		const destroyed = new Set<string>();
		scoped.on("Target.targetDestroyed", ({ targetId }) => destroyed.add(targetId));
		let targetId: string | undefined;
		let page: Cdp | undefined;
		let abortedAt: number | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let closing: Promise<void> | undefined;
		const close = () => {
			if (!targetId) {
				return;
			}
			const remaining =
				DISPOSE_DEADLINE_MS - (abortedAt === undefined ? 0 : performance.now() - abortedAt);
			closing ??= this.closeTarget(targetId, scoped, destroyed, remaining);
			// Cancellation may start disposal before acquisition unwinds; finally still awaits its result.
			closing.catch(() => undefined);
			return closing;
		};
		const stop = () => {
			abortedAt = performance.now();
			page?.abort(abortError(signal.reason));
			// A known target can close while attach is pending. Confirmed destruction releases that wait, even without its reply.
			close()?.then(
				() => scoped.abort(abortError(signal.reason)),
				(error: unknown) => scoped.abort(abortError(error)),
			);
			// Creating/attaching is irreversible. Retain its reply through the reserved cleanup window, not just the work budget.
			timer = setTimeout(
				() =>
					scoped.abort(
						new ChromeError("temporary page acquisition did not finish within its cleanup budget"),
					),
				DISPOSE_DEADLINE_MS,
			);
		};
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) {
			stop();
		}
		try {
			if (signal.aborted) {
				throw abortError(signal.reason);
			}
			await scoped.send("Target.setDiscoverTargets", { discover: true });
			if (signal.aborted) {
				throw abortError(signal.reason);
			}
			({ targetId } = await scoped.send<{ targetId: string }>("Target.createTarget", {
				url: "about:blank",
			}));
			if (signal.aborted) {
				throw abortError(signal.reason);
			}
			const { sessionId } = await scoped.send<{ sessionId: string }>("Target.attachToTarget", {
				targetId,
				flatten: true,
			});
			page = new Cdp(this.wire, sessionId);
			if (signal.aborted) {
				page.abort(abortError(signal.reason));
			}
			await page.send("Inspector.enable");
			return await fn(page);
		} finally {
			signal.removeEventListener("abort", stop);
			clearTimeout(timer);
			try {
				await close();
			} finally {
				if (page) {
					this.wire.clients.delete(page);
				}
				this.wire.clients.delete(scoped);
			}
		}
	}

	private async attach<T>(fn: (cdp: Cdp) => Promise<T>, browserContextId: string | undefined) {
		const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", {
			url: "about:blank",
			browserContextId,
		});
		const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		const page = new Cdp(this.wire, sessionId);
		try {
			await page.send("Inspector.enable");
			return await fn(page);
		} finally {
			this.wire.clients.delete(page);
		}
	}

	/** Destruction is observable even if cancellation preceded attachment; an acknowledgement alone is not closure. */
	private async closeTarget(
		targetId: string,
		observer: Cdp,
		destroyed: Set<string>,
		remaining: number,
	): Promise<void> {
		if (destroyed.has(targetId)) {
			return;
		}
		if (remaining <= 0) {
			throw new ChromeError("temporary page could not be closed within its cleanup budget");
		}
		const closed = this.wait<void>(
			"the temporary page did not close within its cleanup budget",
			remaining,
			(ok) => {
				const onDestroyed = (event: { targetId: string }) => {
					if (event.targetId === targetId) {
						ok();
					}
				};
				observer.on("Target.targetDestroyed", onDestroyed);
				return () => observer.off("Target.targetDestroyed", onDestroyed);
			},
		);
		closed.catch(() => undefined);
		await this.send("Target.closeTarget", { targetId }, remaining);
		await closed;
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
		return this.wait<T>(
			`Chrome did not answer ${method} in ${seconds(deadline)}`,
			deadline,
			(ok, fail) => {
				const id = this.wire.write(method, params, this.sessionId);
				this.wire.pending.set(id, (r) =>
					r.error ? fail(new ChromeError(`${method}: ${r.error.message}`)) : ok(r.result as T),
				);
				return () => this.wire.pending.delete(id);
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
	/** Runs inspector work at a debugger stop; page tasks wait rather than being discarded, and resume even on failure. */
	async paused<T>(work: () => Promise<T>): Promise<T> {
		await this.send("Debugger.enable");
		const paused = this.once("Debugger.paused", "the page's debugger stop", CALL_DEADLINE_MS);
		paused.catch(() => undefined);
		const stopped = this.send("Runtime.evaluate", { expression: "debugger;" });
		stopped.catch(() => undefined);
		try {
			await paused;
			return await work();
		} finally {
			await this.send("Debugger.disable");
			// This evaluation replies only on resume. If work stalled, keep its own error rather than the trigger's deadline.
			await stopped.catch(() => undefined);
		}
	}
	/** Subscribes to the client's events (the browser's before attachment); returns a remover for shorter-lived observers. */
	on<E extends keyof CdpEvents>(event: E, fn: (params: CdpEvents[E]) => void): () => void {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
		return () => this.off(event, fn);
	}
	/** Resolves on the next `event`; `what` names it in the error when it does not come within `deadline` ms. */
	private once(event: keyof CdpEvents, what: string, deadline: number): Promise<void> {
		return this.wait<void>(`${what} did not come in ${seconds(deadline)}`, deadline, (ok) => {
			const listener = () => ok();
			this.on(event, listener);
			return () => this.off(event, listener);
		});
	}
	private off<E extends keyof CdpEvents>(event: E, fn: (params: CdpEvents[E]) => void) {
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
		this.wire.output.end();
	}
}
