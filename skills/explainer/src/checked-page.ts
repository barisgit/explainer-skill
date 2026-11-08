import type { Cdp, ExceptionDetails } from "./cdp.ts";
import { TIMERS_JS, TIMERS_URL } from "./page-js.ts";
import { PAGE_JS, type PageReport } from "./page-probes.ts";
import { settlePage } from "./steps.ts";

/** One emulated screen; the same dimensions and media apply to screenshots and control probes. */
export interface Screen {
	theme: string;
	name: string;
	vp: { width: number; height: number };
}

/** A live checked page: error collection, fresh Keep-cleared loads, emulation and layout analysis without screenshots. */
export class CheckedPage {
	readonly cdp: Cdp;
	readonly url: string;
	problems: string[] = [];
	warnings: string[] = [];

	constructor(cdp: Cdp, url: string) {
		this.cdp = cdp;
		this.url = url;
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) => {
			const message = `page error: ${d.exception?.description ?? d.text}`;
			this.problems.push(`${message.split("\n")[0] ?? message} (at ${errorLocation(d)})`);
		});
		cdp.on("Runtime.consoleAPICalled", ({ type, args }) => this.onConsole(type, consoleText(args)));
		cdp.on("Log.entryAdded", ({ entry }) => {
			if (entry.level === "warning" && entry.source !== "console-api") {
				this.warnings.push(shorten(`${entry.source} warning: ${entry.text}`));
			}
			if (entry.level === "error") {
				this.problems.push(`${entry.source}: ${entry.text} ${entry.url ?? ""}`);
			}
		});
		cdp.on("Network.requestWillBeSent", ({ request }) => {
			if (/^(https?|wss?|ftp):/.test(request.url)) {
				this.problems.push(`network request: ${request.url}`);
			}
		});
		cdp.on("Network.loadingFailed", ({ canceled, errorText }) => {
			if (!canceled) {
				this.problems.push(`failed load: ${errorText}`);
			}
		});
	}

	/** Enables diagnostics and tracks short timers on every later document. */
	async start(): Promise<void> {
		await Promise.all(
			["Page", "Runtime", "Log", "Network"].map((d) => this.cdp.send(`${d}.enable`)),
		);
		await this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TIMERS_JS });
	}

	/** Applies the screen before loading, including reduced motion for deterministic settled states. */
	async screen({ theme, name, vp }: Screen): Promise<void> {
		await this.cdp.send("Emulation.setDeviceMetricsOverride", {
			...vp,
			deviceScaleFactor: 1,
			mobile: name === "narrow",
		});
		await this.cdp.send("Emulation.setEmulatedMedia", {
			features: [
				{ name: "prefers-color-scheme", value: theme },
				{ name: "prefers-reduced-motion", value: "reduce" },
			],
		});
	}

	/** Unloads before clearing saved state; clears tab storage before author scripts on this load only, not explicit reloads. */
	async open(hash = ""): Promise<void> {
		this.problems = [];
		this.warnings = [];
		await this.cdp.load("about:blank");
		const { identifier } = await this.cdp.send<{ identifier: string }>(
			"Page.addScriptToEvaluateOnNewDocument",
			{
				source:
					"window[Symbol.for('explainer.check.fresh')] = true; localStorage.clear(); sessionStorage.clear();",
			},
		);
		try {
			await this.cdp.load(this.url + hash);
		} finally {
			await this.cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
		}
		const missing = await settlePage(this.cdp);
		if (missing) {
			this.problems.push(`${hash ? `${hash}: ` : ""}${missing}`);
		}
	}

	/** Collects repeated IDs/overflow as problems and returns layout warnings; console warnings remain in warnings. */
	async inspect({ name, vp }: Screen): Promise<{ warnings: string[]; scrolls: string[] }> {
		const page = await this.cdp.evaluate<PageReport>(PAGE_JS(name === "narrow"));
		this.problems.push(...page.repeated);
		if (page.overflow) {
			this.problems.push(
				`horizontal page overflow at ${vp.width}px; outside any scroll container: ${page.culprits.join(", ") || "unknown"}`,
			);
		}
		return { warnings: page.warnings, scrolls: page.scrolls.map((s) => `scrolls sideways: ${s}`) };
	}

	private onConsole(type: string, text: string) {
		if (type === "error") {
			this.problems.push(`console.error: ${text}`);
		}
		// ECharts also sends warnings through console.log.
		if (type === "warning" || /^\[ECharts\]/.test(text)) {
			const hint = /grid\.containLabel/.test(text)
				? " [kit: delete containLabel; charts.js already keeps axis labels inside the grid margins]"
				: "";
			this.warnings.push(shorten(`console.${type}: ${text}`) + hint);
		}
	}
}

/** The top page-owned stack frames, excluding the timer instrumentation, or the syntax-error position. */
function errorLocation(d: ExceptionDetails): string {
	const frames = (d.stackTrace?.callFrames ?? []).filter((f) => f.url !== TIMERS_URL).slice(0, 3);
	if (!frames.length) {
		return `${d.lineNumber + 1}:${d.columnNumber + 1}`;
	}
	return frames
		.map((f) => `${f.functionName || "<anonymous>"} ${f.lineNumber + 1}:${f.columnNumber + 1}`)
		.join(", ");
}

const consoleText = (args: Array<{ value?: unknown; description?: string }>) =>
	args.map((a) => a.value ?? a.description ?? "").join(" ");
const shorten = (text: string) => (text.length > 220 ? `${text.slice(0, 217)}...` : text);
