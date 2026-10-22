import type { PageSink } from "./browser.ts";
import type { Seen } from "./probe.ts";

const STACK_FRAMES = 3;

/** Where the probe was injected into the served page; positions after it on that line moved right by `length`. */
interface Injection {
	line: number;
	col: number;
	length: number;
}

interface Frame {
	name: string;
	line: number;
	col: number;
}

/**
 * The frames of an error stack in the page's own coordinates. V8 writes `at name (url:line:col)` or `at url:line:col`, JavaScriptCore
 * `name@url:line:col`; frames without a position (native code) are skipped, and an anonymous function or the top level has no name.
 */
function frames(stack: string, injection: Injection): Frame[] {
	const found: Frame[] = [];
	for (const raw of stack.split("\n")) {
		const text = raw.trim();
		const at = /:(\d+):(\d+)\)?$/.exec(text);
		if (!at) {
			continue;
		}
		const name = /^at (.+?) \(/.exec(text)?.[1] ?? /^([^@\s][^@]*)@/.exec(text)?.[1] ?? "";
		found.push(place(functionName(name), Number(at[1]), Number(at[2]), injection));
	}
	return found;
}

/** The function's own name: V8 qualifies a method with its receiver (`IntersectionObserver.spy`) and marks `async` and `new`; JavaScriptCore names the top level `global code`. */
const functionName = (name: string) =>
	name === "global code" ? "" : name.replace(/^(async |new )/, "").replace(/^.*\./, "");

function place(name: string, line: number, col: number, injection: Injection): Frame {
	const moved = line === injection.line && col >= injection.col + injection.length;
	return { name, line, col: moved ? col - injection.length : col };
}

/** "inner 3:38, outer 4:28": the top frames, or the position alone for an error without a stack (a syntax error). */
function location(
	item: Extract<Seen, { kind: "error" | "rejection" }>,
	injection: Injection,
): string {
	const top = frames(item.stack, injection).slice(0, STACK_FRAMES);
	if (!top.length) {
		const { line, col } = place("", item.line, item.col, injection);
		return `${line}:${col}`;
	}
	return top.map((f) => `${f.name || "<anonymous>"} ${f.line}:${f.col}`).join(", ");
}

const shorten = (text: string) => (text.length > 220 ? `${text.slice(0, 217)}...` : text);

/** A console argument as the view hands it over: a primitive, or an object (CDP's description, or its JSON). */
const argText = (arg: unknown) =>
	typeof arg === "object" && arg !== null
		? ((arg as { description?: string }).description ?? JSON.stringify(arg))
		: String(arg);

/** Collects what the page reports while it loads and runs: problems fail the check, warnings are only listed. */
export class PageLog implements PageSink {
	problems: string[] = [];
	warnings: string[] = [];

	/** Takes what the probe saw (see `Page.take`). */
	add(seen: Seen[], injection: Injection) {
		for (const item of seen) {
			if (item.kind === "network") {
				this.problems.push(`network request: ${item.url}`);
			} else if (item.kind === "resource") {
				this.problems.push(`failed load: ${item.tag} ${item.url}`);
			} else {
				const message = `page error: ${item.text}`.split("\n")[0] ?? "";
				this.problems.push(`${message} (at ${location(item, injection)})`);
			}
		}
	}

	/** Forgets everything reported so far, before the next page load. */
	reset() {
		this.problems = [];
		this.warnings = [];
	}

	onConsole(type: string, args: unknown[]) {
		const text = args.map(argText).join(" ");
		if (type === "error") {
			this.problems.push(`console.error: ${text}`);
		}
		// ECharts reports its own warnings (bad option, missing component) with console.log, so its prefix counts as a warning too.
		if (type === "warn" || type === "warning" || /^\[ECharts\]/.test(text)) {
			const hint = /grid\.containLabel/.test(text)
				? " [kit: delete containLabel; charts.js already keeps axis labels inside the grid margins]"
				: "";
			this.warnings.push(shorten(`console.${type}: ${text}`) + hint);
		}
	}
}
