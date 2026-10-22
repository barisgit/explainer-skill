import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_PATHS = [
	process.env.CHROME,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/opt/homebrew/bin/chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];

/** Minimal Chrome DevTools Protocol client: request/response plus event subscription. */
export class Cdp {
	private id = 0;
	private pending = new Map<number, (r: { result?: unknown; error?: { message: string } }) => void>();
	private listeners: Array<(method: string, params: any) => void> = [];
	private readonly ws: WebSocket;
	private constructor(ws: WebSocket) {
		this.ws = ws;
		ws.onmessage = (m) => {
			const msg = JSON.parse(String(m.data));
			if (msg.id) this.pending.get(msg.id)?.(msg);
			else for (const l of this.listeners) l(msg.method, msg.params);
		};
	}
	static async connect(url: string): Promise<Cdp> {
		const ws = new WebSocket(url);
		await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("cannot connect to Chrome")); });
		return new Cdp(ws);
	}
	send<T = any>(method: string, params: object = {}): Promise<T> {
		const id = ++this.id;
		return new Promise((ok, fail) => {
			this.pending.set(id, (r) => (r.error ? fail(new Error(`${method}: ${r.error.message}`)) : ok(r.result as T)));
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}
	on(fn: (method: string, params: any) => void) { this.listeners.push(fn); }
	once(event: string): Promise<void> {
		return new Promise((ok) => this.on((m) => m === event && ok()));
	}
	close() { this.ws.close(); }
}

/** Starts headless Chrome and resolves with its DevTools HTTP port. */
export async function launch(profile: string): Promise<{ port: number; stop: () => void }> {
	const bin = CHROME_PATHS.find((p) => p && existsSync(p));
	if (!bin) throw new Error("no Chrome found: set CHROME=/path/to/chrome");
	const proc = spawn(bin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
	const port = await new Promise<number>((ok, fail) => {
		let log = "";
		proc.stderr.on("data", (d) => {
			log += d;
			const m = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
			if (m) ok(Number(m[1]));
		});
		proc.on("exit", () => fail(new Error(`Chrome exited early:\n${log.slice(-400)}`)));
	});
	return { port, stop: () => proc.kill() };
}

/** Runs `fn` against the page of a fresh headless Chrome; Chrome and its profile are always cleaned up. */
export async function withPage<T>(fn: (cdp: Cdp) => Promise<T>): Promise<T> {
	const profile = mkdtempSync(join(tmpdir(), "artifact-chrome-"));
	const chrome = await launch(profile);
	try {
		const target = await fetch(`http://127.0.0.1:${chrome.port}/json/list`).then((r) => r.json() as Promise<any[]>);
		const cdp = await Cdp.connect(target.find((t) => t.type === "page").webSocketDebuggerUrl);
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
