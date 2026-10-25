import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { check, kitReferences } from "./check.ts";
import { kitFiles, kitPath, leadingComment, readKitText } from "./kit.ts";
import { PackError, pack } from "./pack.ts";
import { report } from "./report.ts";
import { stepError } from "./steps.ts";

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

const MERMAID_DOC = `<pre class="mermaid"> blocks hold Mermaid source: flowchart (graph), stateDiagram-v2, sequenceDiagram, classDiagram, erDiagram or xychart-beta.
pack renders each block to one SVG that follows light and dark, so no script ships; other types fail the pack with a suggestion (a pie or gantt is a chart: kit charts.js).
It draws a subset of each type and fails on any line, or part of one, it cannot read (notes, titles, cross and circle edge ends, new-style shapes) and on a block left open, naming the line.
Labels wrap at about 30 characters into tall boxes: keep them to a few words, or break one with <br>. Markdown strings ("\`...\`") are not supported; **bold** and *italic* work in plain labels.
Pack gives every part of the diagram a data-ref equal to its Mermaid id, so the page can address it without knowing the SVG:
  flowchart / state / class / ER   nodes and subgraphs: the node id (cache in "api --> cache[(Cache)]")
  edges                            the edge id: name one with "api e1@--> cache" (otherwise Mermaid's, e.g. L_api_cache_0)
  sequence                         participants and lifelines: the participant id; messages: m1, m2, ... in order
Use the ids from prose and replies:
  <span data-ref="cache">the cache</span>                  hover or focus lights the node (kit:link.js)
  clicking a node offers a note on it (kit:reply.js)
Diagrams do not step: pack fails on data-steps. To walk through one, show it whole and give each step's text the data-ref of its parts.
Keep ids short and meaningful: they are what you type here.
Colours are the kit tokens, read by the browser, so any token the page overrides (e.g. :root { --accent: ... }) reaches the diagram.
Phones: the diagram scales to the column, so a wide left-to-right chart gets tiny text; prefer top-down (flowchart TD) and few nodes. check warns under 9 px.`;

/** Leading comment block of a kit file, comment markers removed; its first line is the one-line description. */
function kitHeader(file: string): string {
	return leadingComment(readFileSync(kitPath(file), "utf8"))
		.slice(2, -2)
		.split("\n")
		.map((l) => l.replace(/^\s{0,3}/, ""))
		.join("\n")
		.trim();
}

/** The one-line description of a kit file: the first line of its header without the leading "name: ". */
const kitSummary = (file: string) => (kitHeader(file).split("\n")[0] ?? "").replace(/^\S+: /, "");

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
				const kb = `${(Buffer.byteLength(readKitText(kitPath(f))) / 1024).toFixed(0)} KB`;
				console.log(`kit:${f.padEnd(11)} ${kb.padStart(7)}  ${kitSummary(f)}`);
			}
			console.log(
				`<pre class="mermaid">...</pre>  diagram source (flowchart, state, sequence, class, ER, xychart); pack renders it as one SVG for light and dark and gives every node, edge and participant a data-ref of its Mermaid id (kit mermaid)\n\nDocumentation of one file: ${CLI} kit <file>. Fonts are inlined from theme.css. Attributes the kit scripts read: data-view, data-nav, data-stepper, data-start, data-step, data-captions, data-ref, data-reply, data-keep.\nThe texts the kit scripts add (buttons, accessible names, messages) are English; a page in another language sets them in var kitLabels = { ... } at the top level of any of its scripts, with the keys each file's documentation lists.`,
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
			"Open a packed file in headless Chrome: light+dark x desktop(1440)+narrow(390). Saves a first-viewport and a full-page PNG per theme and size, plus one full-page PNG per drill-down view and one PNG of an element per --do shot:<css>, into a fresh temp directory (printed) unless --out says where. Scrolls each page (and view) to its end and back before the full-page shots, so errors thrown by scroll handlers and IntersectionObserver callbacks are caught (at most 3 s per page). Reports first-screen info, errors, network requests and overflow as problems (exit 1), and console warnings, tiny diagram text, content cut off inside an overflow:hidden box, a missing viewport meta, over-tall diagrams and charts, sideways-scrolling containers and steppers whose steps change only their captions as warnings.",
		usage:
			"check <artifact.html> [--do <step>]... [--view <hash|all|none>]... [--quick] [--tag <name>] [--out dir] [--json]",
		flags: [
			"--do <step>      run before the full-page shots, in order, repeatable. Its state persists into every saved full-page PNG (all themes and sizes); the first-viewport PNG is taken before it and drill-down views load fresh without it.\n                   click:<css>          first match (DOM click, element focused first)\n                   click:<css>@all      every match in turn, re-queried before each click (the output says how many)\n                   click:<css>@<n>      the n-th match, 0-based\n                   click:<x,y>          real mouse click at a point; use it for chart marks\n                   hover:<css | x,y>    real mouse move; fires :hover and chart tooltips (a tooltip is not in the full-page PNGs, which are taken after a relayout)\n                   focus:<css>          focus the first match, so key: reaches it\n                   key:<Key>            to the focused element: ArrowLeft/Right/Up/Down, Enter, Space, Escape, Tab, Home, End, Backspace, or one character; arrows move a focused range by its step and a select by one option\n                   type:<css>=<text>    type over the first match's text key by key (a newline presses Enter), then leave it, so input and change fire; type:#q= clears it\n                   set:<css>=<value>    set a range, select, date or other field's value at once, then fire input and change\n                   shot:<css>           PNG of the first match's box as the page is at this step (@all: each match; @<n>: that one), per theme and size, listed in the report\n                   reload               reload the page, keeping what it saved for the reader (kit:reply.js); each load otherwise starts with empty storage\n                   Attribute values may be unquoted: [value=0] works. The value of type: and set: starts after the first = outside [...].",
			"--quick          light theme only, no first-viewport shots; writes desktop.png and narrow.png into --out (a temp directory without it)",
			"--view <what>    choose drill-down views to capture. The report lists every view hash found (links and static views) and which were captured. Default: the first hash of each view name, at most 6 names. --view all = every hash found (one PNG set each: slower). A hash (repo/mobile) captures exactly the hashes given; repeatable. none = overview only. Hashes only a script navigates to are never found: pass them as --view name/param.",
			"--tag <name>     add to the PNG names so states do not overwrite each other; with --quick too (kind-desktop.png)",
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
			"check artifact.html --do 'type:#search=heat pump' --do 'set:select[name=unit]=kWh' --tag kwh",
			"check artifact.html --quick --do shot:section@all",
			"check artifact.html --do shot:#chart --do click:.tab@1 --do shot:#chart",
			"check artifact.html --view option/block-sort",
			"check artifact.html --view all",
		],
		run: async ([file], flags) => {
			if (!file || !existsSync(file)) {
				return usage(`check needs an existing file. Example: check artifact.html`);
			}
			const unpacked = await kitReferences(readFileSync(file, "utf8"));
			if (unpacked.length) {
				return usage(
					`${file} still references ${unpacked.join(", ")}: check opens packed files. Run: pack ${file} -o artifact.html, then check artifact.html`,
				);
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
