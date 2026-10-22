import { userInfo } from "node:os";
import { basename } from "node:path";
import { instrument, type Seen, type Settings } from "./probe.ts";

const { CHROME, EXPLAINER_BACKEND } = process.env;
/** The most CSS pixels of height a view can have; a taller page is cut off in full-page shots. */
export const MAX_HEIGHT = 16384;
const RESIZE_SETTLE_MS = 150;
const FIT_ROUNDS = 3;

/** Waits `ms` milliseconds, for page scripts, transitions and rebuilt DOM to settle after a load or an action. */
export const settle = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** The browser could not be started or driven: an environment problem the CLI reports without a stack trace. */
export class BrowserError extends Error {}

export type Backend = "webkit" | "chrome";

/**
 * Bun's own default (WKWebView on macOS, an installed Chrome elsewhere), unless `EXPLAINER_BACKEND=chrome` or `CHROME=/path` asks for
 * Chrome. A Chrome Bun spawns gets the old launcher's two guards: a mock keychain, so macOS never shows a keychain dialog, and,
 * on the retry, no sandbox (Ubuntu 23.10+ and most containers cannot build one).
 */
function backendOptions(noSandbox: boolean): { backend: Backend; option?: Bun.WebView.Backend } {
	if (!CHROME && EXPLAINER_BACKEND !== "chrome") {
		return { backend: process.platform === "darwin" ? "webkit" : "chrome" };
	}
	// A sandboxed HOME has no login keychain, and Chrome would ask to create one.
	Object.assign(process.env, { HOME: userInfo().homedir });
	const argv = ["--use-mock-keychain", ...(noSandbox ? ["--no-sandbox"] : [])];
	return {
		backend: "chrome",
		option: { type: "chrome", url: false, argv, ...(CHROME && { path: CHROME }) },
	};
}

/** Everything the page tells the check about itself, however it got there. */
export interface PageSink {
	onConsole(type: string, args: unknown[]): void;
}

/** A page served to the browser from memory, instrumented for the current settings. */
class Served {
	private readonly server: Bun.Server<undefined>;
	readonly url: string;
	settings: Settings = { scheme: "light", reduceMotion: false };
	line = 0;
	col = 0;
	length = 0;

	constructor(html: string, name: string) {
		const path = `/${encodeURIComponent(name)}`;
		this.server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: (req) => {
				if (new URL(req.url).pathname !== path) {
					return new Response("not found", { status: 404 });
				}
				const page = instrument(html, this.settings);
				[this.line, this.col, this.length] = [page.line, page.col, page.length];
				return new Response(page.html, {
					headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
				});
			},
		});
		this.url = `http://127.0.0.1:${this.server.port}${path}`;
	}

	stop() {
		void this.server.stop(true);
	}
}

/**
 * One headless browser page (a `Bun.WebView`): WKWebView on macOS, Chrome elsewhere. The engines differ in what they expose, so
 * everything a check needs from the page is built on `evaluate`, the high-level input methods and a probe script (`probe.ts`).
 */
export class Page {
	readonly view: Bun.WebView;
	readonly backend: Backend;
	private served: Served | undefined;
	private width: number;
	private height: number;

	private constructor(view: Bun.WebView, backend: Backend, width: number, height: number) {
		[this.view, this.backend, this.width, this.height] = [view, backend, width, height];
	}

	/** Starts a browser and waits until it answers; retries a Chrome that died at launch once without its sandbox. */
	static async open(width: number, height: number, sink?: PageSink): Promise<Page> {
		for (const noSandbox of [false, true]) {
			const { backend, option } = backendOptions(noSandbox);
			let view: Bun.WebView | undefined;
			try {
				view = new Bun.WebView({
					width,
					height,
					...(option && { backend: option }),
					...(sink && { console: (type, ...args) => sink.onConsole(type, args) }),
				});
				await view.navigate("about:blank");
				// Chrome's first view can come up shorter than asked for.
				await view.resize(width, height);
				return new Page(view, backend, width, height);
			} catch (error) {
				view?.close();
				if (noSandbox || backend !== "chrome") {
					throw new BrowserError(`cannot start a headless browser: ${String(error)}`);
				}
				// Bun spawns one browser per process; the dead one is cleared asynchronously, and a spawn before that fails.
				Bun.WebView.closeAll();
				await Bun.sleep(500);
			}
		}
		throw new BrowserError("unreachable");
	}

	/** Evaluates `expression` in the page and returns its JSON value; throws with the page's error when the script throws. */
	evaluate<T>(expression: string): Promise<T> {
		return this.view.evaluate(expression) as Promise<T>;
	}

	async resize(width: number, height: number) {
		[this.width, this.height] = [width, height];
		await this.view.resize(width, height);
	}

	/** Makes `html` the page, served as `name` from an address that is new for every Page; `settings` apply to every load of it. */
	serve(html: string, name: string) {
		this.served?.stop();
		this.served = new Served(html, basename(name));
	}

	/**
	 * Loads `url`, through about:blank so that a change of hash alone is a real load. The probe empties storage at the start of
	 * every load but a reload, so nothing the old page wrote on its way out reaches the new one.
	 */
	async load(url: string, settings?: Settings) {
		if (this.served) {
			this.served.settings = settings ?? this.served.settings;
		}
		await this.view.navigate("about:blank");
		await this.view.navigate(url);
	}

	/** Loads the served page under `settings`. */
	loadServed(hash: string, settings: Settings) {
		if (!this.served) {
			throw new BrowserError("no page is served");
		}
		return this.load(this.served.url + hash, settings);
	}

	/** Reloads like the reader would (same URL, same storage). WebKit settles the call before the load is done, so wait for the event. */
	async reload() {
		const loaded = new Promise<void>((ok) => {
			this.view.onNavigated = () => ok();
		});
		await this.view.reload();
		await loaded;
		this.view.onNavigated = null;
	}

	/** What the probe collected since the last call. Positions on the line the probe was injected into are mapped back to the page's own. */
	async take(): Promise<Seen[]> {
		return this.evaluate<Seen[]>("window.__explainer ? window.__explainer.take() : []");
	}

	/** Where the probe was injected in the page being served, for `take()`'s positions. */
	get injection() {
		const { line, col, length } = this.served ?? { line: 0, col: 0, length: 0 };
		return { line, col, length };
	}

	/** A PNG of the viewport at one pixel per CSS pixel: WKWebView renders at the display's scale, so a retina capture is scaled down. */
	async screenshot(): Promise<Uint8Array> {
		const png = await this.view.screenshot({ encoding: "buffer" });
		const { width } = await new Bun.Image(png).metadata();
		return width === this.width ? png : await new Bun.Image(png).resize(this.width).png().bytes();
	}

	private contentHeight() {
		return this.evaluate<number>("Math.ceil(document.documentElement.scrollHeight)");
	}

	/**
	 * A PNG of the whole page. A view only captures its viewport, so the viewport is made as tall as the page for the shot (up to
	 * MAX_HEIGHT) and restored after. Content that depends on the viewport height (100vh) grows with it, so the fit gives up after a few rounds.
	 */
	async fullScreenshot(): Promise<Uint8Array> {
		let fit = Math.min(Math.max(await this.contentHeight(), this.height), MAX_HEIGHT);
		for (let round = 0; round < FIT_ROUNDS; round++) {
			await this.view.resize(this.width, fit);
			await settle(RESIZE_SETTLE_MS);
			const needed = Math.min(await this.contentHeight(), MAX_HEIGHT);
			if (needed <= fit) {
				break;
			}
			fit = needed;
		}
		const png = await this.screenshot();
		await this.view.resize(this.width, this.height);
		return png;
	}

	close() {
		this.served?.stop();
		this.view.close();
	}
}

/** Runs `fn` against a fresh page of the default browser; the browser is always closed after. */
export async function withPage<T>(
	width: number,
	height: number,
	fn: (page: Page) => Promise<T>,
	sink?: PageSink,
): Promise<T> {
	const page = await Page.open(width, height, sink);
	try {
		return await fn(page);
	} finally {
		page.close();
	}
}
