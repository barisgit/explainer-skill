import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check, type Shot, stepError, type ViewReport } from "./check.ts";
import { pack, PackError } from "./pack.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = `bun ${process.argv[1]}`;

interface Command {
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
	return block.split("\n").map((l) => l.replace(/^\s{0,3}/, "")).join("\n").trim();
}

const kitFiles = () => readdirSync(KIT_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();

/** One spec per command: drives dispatch, flag validation and --help. Exit codes: 0 ok, 1 problems found, 2 usage. */
const COMMANDS: Record<string, Command> = {
	kit: {
		summary: "List the kit files a page can reference (pack inlines only the ones it uses), or print the documentation of one file or of the mermaid blocks.",
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
				if (!kitFiles().includes(name)) return usage(`no kit file "${name}". Run: ${CLI} kit`);
				console.log(kitHeader(name));
				return 0;
			}
			console.log(`Reference kit files from the page with the kit: prefix; pack inlines each one used:\n  <link rel="stylesheet" href="kit:theme.css">\n  <script src="kit:charts.js"></script>      scripts run in the order written; charts.js needs kit:echarts.js before it\n`);
			for (const f of kitFiles()) {
				const kb = `${(statSync(join(KIT_DIR, f)).size / 1024).toFixed(0)} KB`;
				console.log(`kit:${f.padEnd(11)} ${kb.padStart(7)}  ${kitHeader(f).split("\n")[0]!.replace(/^\S+: /, "")}`);
			}
			console.log(`<pre class="mermaid">...</pre>  diagram source (flowchart, sequence, state, class, ER, gantt, pie, ...); pack renders it in light and dark and gives every node, edge and participant a data-ref of its Mermaid id (kit mermaid)\n\nDocumentation of one file: ${CLI} kit <file>. Fonts are inlined from theme.css. Attributes the kit scripts read: data-view, data-stepper, data-step, data-steps, data-captions, data-ref, data-reply.`);
			return 0;
		},
	},
	pack: {
		summary: "Inline local CSS, scripts, images, fonts and kit: files into one HTML file; render pre.mermaid diagrams; fail on any network dependency.",
		usage: "pack <page.html> -o <artifact.html>",
		flags: ["-o <file>  output path (required)"],
		examples: ["pack page.html -o artifact.html"],
		run: async ([input], flags) => {
			const out = flags.get("-o")?.[0];
			if (!input || !out) return usage("pack needs an input and -o. Example: pack page.html -o artifact.html");
			try {
				const { html, warnings } = await pack(input);
				writeFileSync(out, html);
				console.log(`packed ${out} (${(html.length / 1024).toFixed(0)} KB), no network dependencies${warnings.map((w) => `\nwarning: ${w}`).join("")}\nnext: ${CLI} check ${out}`);
				return 0;
			} catch (e) {
				if (!(e instanceof PackError)) throw e;
				console.error(`pack failed:\n${e.message}`);
				return 1;
			}
		},
	},
	check: {
		summary: "Open a packed file in headless Chrome: light+dark x desktop(1440)+narrow(390). Saves a first-viewport and a full-page PNG per theme and size, plus one full-page PNG per drill-down view, into a fresh temp directory (printed) unless --out says where. Reports first-screen info, errors, network requests and overflow as problems (exit 1), and console warnings, tiny diagram text, a missing viewport meta, over-tall diagrams and charts and sideways-scrolling containers as warnings.",
		usage: "check <artifact.html> [--do <step>]... [--view <hash|all|none>]... [--quick] [--tag <name>] [--out dir] [--json]",
		flags: [
			"--do <step>      run before the full-page shots, in order, repeatable. Its state persists into every saved full-page PNG (all themes and sizes); the first-viewport PNG is taken before it and drill-down views load fresh without it.\n                   click:<css>          first match (DOM click, element focused first)\n                   click:<css>@all      every match in turn, re-queried before each click (the output says how many)\n                   click:<css>@<n>      the n-th match, 0-based\n                   click:<x,y>          real mouse click at a point; use it for chart marks\n                   hover:<css | x,y>    real mouse move; fires :hover and chart tooltips\n                   focus:<css>          focus the first match, so key: reaches it\n                   key:<Key>            to the focused element: ArrowLeft/Right/Up/Down, Enter, Space, Escape, Tab, Home, End, or one character\n                   Attribute values may be unquoted: [value=0] works.",
			"--quick          light theme only, no first-viewport shots; writes desktop.png and narrow.png into --out (a temp directory without it)",
			"--view <what>    choose drill-down views to capture. The report lists every view hash found (links and static views) and which were captured. Default: the first hash of each view name, at most 6 names. --view all = every hash found (one PNG set each: slower). A hash (repo/mobile) captures exactly the hashes given; repeatable. none = overview only. Hashes only a script navigates to are never found: pass them as --view name/param.",
			"--tag <name>     add to the PNG names so states do not overwrite each other",
			"--out <dir>      screenshot directory, created if missing (default: a new temp directory, printed in the report; nothing is written next to the file)",
			"--json           machine-readable result on stdout",
		],
		examples: ["check artifact.html", "check artifact.html --quick --out shots", "check artifact.html --do click:.tab@all --do click:.legend-item@1 --tag open", "check artifact.html --do click:'[data-go=\"1\"]' --do click:'[data-go=\"1\"]' --tag step3", "check artifact.html --do focus:[data-stepper] --do key:ArrowLeft --do key:ArrowLeft --tag back2", "check artifact.html --do click:700,300 --do hover:#chart --tag mark", "check artifact.html --view option/block-sort", "check artifact.html --view all"],
		run: async ([file], flags) => {
			if (!file || !existsSync(file)) return usage(`check needs an existing file. Example: check artifact.html`);
			const steps = flags.get("--do") ?? [];
			const bad = steps.map(stepError).find(Boolean);
			if (bad) return usage(bad);
			const out = resolve(flags.get("--out")?.[0] ?? mkdtempSync(join(tmpdir(), "explainer-check-")));
			const { shots, views, stepNotes } = await check(file, out, { steps, views: flags.get("--view") ?? [], tag: flags.get("--tag")?.[0] ?? "", quick: flags.has("--quick") });
			const ok = shots.every((s) => !s.problems.length);
			if (flags.has("--json")) console.log(JSON.stringify({ ok, out, shots, views, stepNotes }, null, 2));
			else console.log(report(out, shots, views, stepNotes));
			return ok ? 0 : 1;
		},
	},
};

/** The check result as text: first screens, then pass/fail per shot with problems, then warnings grouped by message. */
function report(outDir: string, shots: Shot[], views: ViewReport, stepNotes: string[]): string {
	const where = (s: Shot) => `${s.theme} ${s.viewport.split(" ")[0]}${s.view ? ` ${s.view}` : ""}`;
	const out: string[] = [`Screenshots: ${outDir}`, ""];
	const firsts = shots.filter((s) => s.first);
	if (firsts.length) {
		out.push("First screens (taken before any --do step; open these first):");
		for (const s of firsts) out.push(`  ${s.theme.padEnd(5)} ${s.viewport.padEnd(17)} ${s.first!.png}\n${" ".repeat(8)}${s.first!.headline ? `"${s.first!.headline}"` : "no h1"} | ${s.first!.figures.length ? `${s.first!.figures.length} figure(s): ${s.first!.figures.join(", ")}` : "no figure in view"}`);
		out.push("");
	}
	out.push("Pages:");
	for (const s of shots) out.push(`  ${s.problems.length ? "FAIL" : "ok  "} ${s.theme.padEnd(5)} ${s.viewport.padEnd(17)} ${(s.view || "overview").padEnd(14)} ${s.png}${s.problems.map((p) => `\n         ${p}`).join("")}`);
	for (const n of stepNotes) out.push(`  --do ${n}`);
	const warned = new Map<string, string[]>();
	for (const s of shots) for (const w of s.warnings) warned.set(w, [...(warned.get(w) ?? []), where(s)]);
	if (warned.size) {
		out.push("", "Warnings (do not fail the check):");
		for (const [w, at] of warned) out.push(`  ${w}\n         at: ${[...new Set(at)].join(", ")}`);
	}
	out.push("", `Views found (${views.found.length}): ${views.found.join(", ") || "none"}`);
	out.push(`Views captured (${views.captured.length}): ${views.captured.join(", ") || "none"}`);
	if (views.uncaptured.length) out.push(`Views not captured: ${views.uncaptured.length} of those (--view all captures every hash found; --view <hash> one)`);
	for (const t of views.templates) out.push(`View "${t}" has no link to follow: pass --view ${t}/<param>`);
	out.push("Open the PNGs (first-screen ones first) and look for clipped text, empty regions, weak contrast, broken layout.");
	return out.join("\n");
}

function usage(message: string): number {
	console.error(`error: ${message}`);
	return 2;
}

function help(name?: string): string {
	if (name && COMMANDS[name]) {
		const c = COMMANDS[name];
		return `${c.summary}\n\nUsage: ${CLI} ${c.usage}\n${c.flags.length ? `\nFlags:\n${c.flags.map((f) => `  ${f}`).join("\n")}\n` : ""}\nExamples:\n${c.examples.map((e) => `  ${CLI} ${e}`).join("\n")}\n`;
	}
	return `Build one self-contained, interactive, visual HTML file that works offline from file://.

Usage: ${CLI} <command> [args]

Commands:
${Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(7)} ${c.summary}`).join("\n")}

Start: ${CLI} kit
Exit codes: 0 ok, 1 problems found (pack/check), 2 usage error. Run ${CLI} <command> --help for flags and examples.
`;
}

const [name, ...rest] = process.argv.slice(2);
if (!name || name === "--help" || name === "-h" || name === "help") {
	console.log(help());
	process.exit(0);
}
const command = COMMANDS[name];
if (!command) process.exit(usage(`unknown command "${name}". Run: ${CLI} --help`));
if (rest.includes("--help") || rest.includes("-h")) {
	console.log(help(name));
	process.exit(0);
}
const known = new Set(command.flags.map((f) => f.split(/\s/)[0]!));
const args: string[] = [];
const flags = new Map<string, string[]>();
for (let i = 0; i < rest.length; i++) {
	const a = rest[i]!;
	if (!a.startsWith("-")) { args.push(a); continue; }
	if (!known.has(a)) process.exit(usage(`unknown flag ${a} for ${name}. Run: ${CLI} ${name} --help`));
	const takesValue = command.flags.find((f) => f.startsWith(a))?.includes("<");
	flags.set(a, [...(flags.get(a) ?? []), ...(takesValue ? [rest[++i] ?? ""] : [])]);
}
process.exit(await command.run(args, flags));
