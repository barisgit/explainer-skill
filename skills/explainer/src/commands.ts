import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { check } from "./check.ts";
import { PackError, pack } from "./pack.ts";
import { report } from "./report.ts";
import { stepError } from "./steps.ts";

const ROOT = join(import.meta.dir, "..");
/** The command line that starts this CLI, as shown in help and hints. */
export const CLI = `bun ${process.argv[1]}`;

/** One command: its help texts, the flags it accepts (`-o <file>  text` takes a value; `--quick  text` is a switch) and what it runs. */
export interface Command {
	summary: string;
	usage: string;
	flags: string[];
	examples: string[];
	run: (args: string[], flags: Map<string, string[]>) => Promise<number>;
}

const KIT_DIR = join(ROOT, "kit");

const MERMAID_DOC = `<pre class="mermaid"> blocks hold Mermaid source (flowchart, sequence, state, class, ER, gantt, pie, ...). pack renders each block once in light and dark, so no script ships.
Pack gives every part of the diagram a data-ref equal to its Mermaid id, so the page can address it without knowing the SVG:
  flowchart / state / class / ER   nodes and subgraphs: the node id (cache in "api --> cache[(Cache)]")
  edges                            the edge id: name one with "api e1@--> cache" (otherwise Mermaid's, e.g. L_api_cache_0)
  sequence                         participants and lifelines: the participant id; messages: m1, m2, ... in order
Use the ids from prose, steps and replies:
  <span data-ref="cache">the cache</span>                  hover or focus lights the node (kit:link.js)
  <pre class="mermaid" data-steps="api:1 cache:2,4 e1:3"> inside a data-stepper: api appears on step 1, cache on 2 and again lit on 4 (kit:steps.js)
  clicking a node offers a note on it (kit:reply.js)
pack fails when data-steps names an id the diagram lacks, and lists the ids it has. Keep ids short and meaningful: they are what you type here.
Colours come from the kit tokens plus overrides in the page's own inline <style> (e.g. :root { --accent: ... }); linked stylesheets are not read.
Phones: Mermaid scales the diagram to the column, so a wide left-to-right chart gets tiny text; prefer top-down (flowchart TD) and few nodes. check warns under 9 px.`;

/** Leading comment block of a kit file, comment markers removed; its first line is the one-line description. */
function kitHeader(file: string): string {
	const block = /^\s*\/\*([\s\S]*?)\*\//.exec(readFileSync(join(KIT_DIR, file), "utf8"))?.[1] ?? "";
	return block
		.split("\n")
		.map((l) => l.replace(/^\s{0,3}/, ""))
		.join("\n")
		.trim();
}

/** The one-line description of a kit file: the first line of its header without the leading "name: ". */
const kitSummary = (file: string) => (kitHeader(file).split("\n")[0] ?? "").replace(/^\S+: /, "");

const kitFiles = () =>
	readdirSync(KIT_DIR, { withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => e.name)
		.sort();

/** One spec per command: drives dispatch, flag validation and --help. Exit codes: 0 ok, 1 problems found, 2 usage. */
export const COMMANDS: Record<string, Command> = {
	kit: {
		summary:
			"List the kit files a page can reference (pack inlines only the ones it uses), or print the documentation of one file or of the mermaid blocks.",
		usage: "kit [file | mermaid]",
		flags: [],
		examples: ["kit", "kit steps.js", "kit mermaid"],
		run: async ([file]) => {
			if (file === "mermaid") {
				console.log(MERMAID_DOC);
				return 0;
			}
			if (file) {
				const name = file.replace(/^kit:/, "");
				if (!kitFiles().includes(name)) {
					return usage(`no kit file "${name}". Run: ${CLI} kit`);
				}
				console.log(kitHeader(name));
				return 0;
			}
			console.log(
				`Reference kit files from the page with the kit: prefix; pack inlines each one used:\n  <link rel="stylesheet" href="kit:theme.css">\n  <script src="kit:charts.js"></script>      scripts run in the order written; charts.js needs kit:echarts.js before it\n  <script src="kit:plot.js"></script>        alone, for a few small plots without ECharts\n`,
			);
			for (const f of kitFiles()) {
				const kb = `${(statSync(join(KIT_DIR, f)).size / 1024).toFixed(0)} KB`;
				console.log(`kit:${f.padEnd(11)} ${kb.padStart(7)}  ${kitSummary(f)}`);
			}
			console.log(
				`<pre class="mermaid">...</pre>  diagram source (flowchart, sequence, state, class, ER, gantt, pie, ...); pack renders it in light and dark and gives every node, edge and participant a data-ref of its Mermaid id (kit mermaid)\n\nDocumentation of one file: ${CLI} kit <file>. Fonts are inlined from theme.css. Attributes the kit scripts read: data-view, data-stepper, data-start, data-step, data-steps, data-captions, data-ref, data-reply.`,
			);
			return 0;
		},
	},
	pack: {
		summary:
			"Inline local CSS, scripts, images, fonts and kit: files into one HTML file; render pre.mermaid diagrams; fail on any network dependency.",
		usage: "pack <page.html> -o <artifact.html>",
		flags: ["-o <file>  output path (required)"],
		examples: ["pack page.html -o artifact.html"],
		run: async ([input], flags) => {
			const out = flags.get("-o")?.[0];
			if (!input || !out) {
				return usage("pack needs an input and -o. Example: pack page.html -o artifact.html");
			}
			if (!existsSync(input)) {
				return usage(
					`pack needs an existing page, not "${input}". Example: pack page.html -o artifact.html`,
				);
			}
			try {
				const { html, warnings } = await pack(input);
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, html);
				console.log(
					`packed ${out} (${(html.length / 1024).toFixed(0)} KB), no network dependencies${warnings.map((w) => `\nwarning: ${w}`).join("")}\nnext: ${CLI} check ${out}`,
				);
				return 0;
			} catch (e) {
				if (!(e instanceof PackError)) {
					throw e;
				}
				console.error(`pack failed:\n${e.message}`);
				return 1;
			}
		},
	},
	check: {
		summary:
			"Open a packed file in headless Chrome: light+dark x desktop(1440)+narrow(390). Saves a first-viewport and a full-page PNG per theme and size, plus one full-page PNG per drill-down view, into a fresh temp directory (printed) unless --out says where. Reports first-screen info, errors, network requests and overflow as problems (exit 1), and console warnings, tiny diagram text, a missing viewport meta, over-tall diagrams and charts and sideways-scrolling containers as warnings.",
		usage:
			"check <artifact.html> [--do <step>]... [--view <hash|all|none>]... [--quick] [--tag <name>] [--out dir] [--json]",
		flags: [
			"--do <step>      run before the full-page shots, in order, repeatable. Its state persists into every saved full-page PNG (all themes and sizes); the first-viewport PNG is taken before it and drill-down views load fresh without it.\n                   click:<css>          first match (DOM click, element focused first)\n                   click:<css>@all      every match in turn, re-queried before each click (the output says how many)\n                   click:<css>@<n>      the n-th match, 0-based\n                   click:<x,y>          real mouse click at a point; use it for chart marks\n                   hover:<css | x,y>    real mouse move; fires :hover and chart tooltips\n                   focus:<css>          focus the first match, so key: reaches it\n                   key:<Key>            to the focused element: ArrowLeft/Right/Up/Down, Enter, Space, Escape, Tab, Home, End, or one character\n                   Attribute values may be unquoted: [value=0] works.",
			"--quick          light theme only, no first-viewport shots; writes desktop.png and narrow.png into --out (a temp directory without it)",
			"--view <what>    choose drill-down views to capture. The report lists every view hash found (links and static views) and which were captured. Default: the first hash of each view name, at most 6 names. --view all = every hash found (one PNG set each: slower). A hash (repo/mobile) captures exactly the hashes given; repeatable. none = overview only. Hashes only a script navigates to are never found: pass them as --view name/param.",
			"--tag <name>     add to the PNG names so states do not overwrite each other",
			"--out <dir>      screenshot directory, created if missing (default: a new temp directory, printed in the report; nothing is written next to the file)",
			"--json           machine-readable result on stdout",
		],
		examples: [
			"check artifact.html",
			"check artifact.html --quick --out shots",
			"check artifact.html --do click:.tab@all --do click:.legend-item@1 --tag open",
			"check artifact.html --do click:'[data-go=\"1\"]' --do click:'[data-go=\"1\"]' --tag step3",
			"check artifact.html --do focus:[data-stepper] --do key:ArrowLeft --do key:ArrowLeft --tag back2",
			"check artifact.html --do click:700,300 --do hover:#chart --tag mark",
			"check artifact.html --view option/block-sort",
			"check artifact.html --view all",
		],
		run: async ([file], flags) => {
			if (!file || !existsSync(file)) {
				return usage(`check needs an existing file. Example: check artifact.html`);
			}
			const steps = flags.get("--do") ?? [];
			const bad = steps.map(stepError).find(Boolean);
			if (bad) {
				return usage(bad);
			}
			const out = resolve(
				flags.get("--out")?.[0] ?? mkdtempSync(join(tmpdir(), "explainer-check-")),
			);
			const { shots, views, stepNotes } = await check(file, out, {
				steps,
				views: flags.get("--view") ?? [],
				tag: flags.get("--tag")?.[0] ?? "",
				quick: flags.has("--quick"),
			});
			const ok = shots.every((s) => !s.problems.length);
			if (flags.has("--json")) {
				console.log(JSON.stringify({ ok, out, shots, views, stepNotes }, null, 2));
			} else {
				console.log(report(out, shots, views, stepNotes));
			}
			return ok ? 0 : 1;
		},
	},
};

/** Reports a usage error on stderr; returns the exit code for it. */
export function usage(message: string): number {
	console.error(`error: ${message}`);
	return 2;
}
