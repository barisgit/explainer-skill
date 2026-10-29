import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { check, DEFAULT_TIMEOUT_SECONDS, kitReferences } from "./check.ts";
import { authorTsconfig, kitLabels, kitPath, leadingComment, readKitText } from "./kit.ts";
import { clientBundle, isClientModule } from "./mdx/bundle.ts";
import { scriptsInCode } from "./mdx/kit-scripts.ts";
import { pageSources } from "./mdx/sources.ts";
import { pack } from "./pack.ts";
import { PackError } from "./pack-error.ts";
import { report } from "./report.ts";
import { SCHEMATIC_DOC } from "./schematic/doc.ts";
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

const MERMAID_DOC = `\`\`\`mermaid fences hold Mermaid source: flowchart (graph), stateDiagram-v2, sequenceDiagram, classDiagram, erDiagram or xychart-beta.
pack renders each one to SVG that follows light and dark, so no script ships; other types fail the pack with a suggestion (a pie or gantt is a chart: kit Chart).
It draws a subset of each type and fails on any line, or part of one, it cannot read (notes, titles, cross and circle edge ends, new-style shapes), naming the line.
Labels wrap at about 30 characters into tall boxes: keep them to a few words, or break one with <br>. Markdown strings ("\`...\`") are not supported; **bold** and *italic* work in plain labels.
Pack gives each node, group, edge and sequence part a data-ref equal to its Mermaid id, so the page can address it without knowing the SVG:
  flowchart / state / class / ER   nodes and subgraphs: the node id (cache in "api --> cache[(Cache)]")
  edges                            the edge id: name one with "api e1@--> cache" (otherwise Mermaid's, e.g. L_api_cache_0)
  sequence                         participants and lifelines: the participant id; messages: m1, m2, ... in order
Use the ids from prose and replies:
  <span data-ref="cache">the cache</span>                  hover or focus lights the node (kit link)
  clicking a node offers a note on it (kit reply, on a page that has it)
Diagrams do not step. To walk through one, show it whole and give each step's text the data-ref of its parts.
Keep ids short and meaningful: they are what you type here.
Colours are the kit tokens, read by the browser, so any token the page overrides (e.g. :root { --accent: ... }) reaches the diagram.
Phones: a flowchart or state diagram too wide for the column also gets a copy laid out across its direction, shown instead; other diagrams shrink no further than readable text and then scroll sideways. Print fits each diagram to the paper. To resize one, set --mermaid-max (widest) or --mermaid-min (narrowest before it scrolls) on its svg.`;

/** Leading comment block of a kit file, comment markers removed; its first line is the one-line description. */
function kitHeader(file: string): string {
	return leadingComment(readFileSync(kitPath(file), "utf8"))
		.slice(2, -2)
		.split("\n")
		.map((l) => l.replace(/^\s{0,3}/, ""))
		.join("\n")
		.trim();
}

/**
 * The kit's Preact components, by the name a page imports ("Chart"), each from the header of its .tsx file in kit/components;
 * the modules they share live in kit/components/parts.
 */
function components(): { name: string; file: string; summary: string }[] {
	// A component file's header starts "Name: description"; a helper module beside them (view-body.ts) has no such line.
	return readdirSync(kitPath("components"))
		.filter((name) => name.endsWith(".tsx"))
		.sort()
		.flatMap((name) => {
			const file = `components/${name}`;
			const [, component, summary = ""] = /^([A-Z]\w*): (.*)/.exec(kitHeader(file)) ?? [];
			return component ? [{ name: component, file, summary }] : [];
		});
}

/** A kit module and every kit module it imports, directly or not, by absolute path. */
function moduleTree(path: string, found = new Set<string>()): Set<string> {
	found.add(path);
	const source = readFileSync(path, "utf8");
	for (const { path: imported } of new Bun.Transpiler({ loader: "tsx" }).scan(source).imports) {
		const next = resolve(dirname(path), imported);
		if (imported.startsWith(".") && !found.has(next)) {
			moduleTree(next, found);
		}
	}
	return found;
}

/**
 * The size `kit` lists for a component: the kit scripts a page using it carries, as pack decides from the compiled code of the
 * component and the kit modules it imports, and the client bundle of its "use client" modules (Preact included), as pack
 * builds it for a page with only that component. A component that draws a Plot or a Chart (Explore) is listed with the Plot's,
 * and a "+" for the more a chart brings.
 */
async function componentSize(file: string): Promise<string> {
	const transpiler = new Bun.Transpiler({ loader: "tsx" });
	const modules = [...moduleTree(kitPath(file))];
	const sources = modules.map((path) => readFileSync(path, "utf8"));
	const scripts = new Set(
		sources.flatMap((code) => [...scriptsInCode(transpiler.transformSync(code))]),
	);
	const either = scripts.has("plot.js") && scripts.has("charts.js");
	const files = [...scripts].filter(
		(script) => !(either && (script === "charts.js" || script === "echarts.js")),
	);
	const clients = modules.filter((_, i) => isClientModule(sources[i] ?? ""));
	// The page that carries the bundle is never written: only its directory is read, for the entry's path.
	const page = { path: join(kitPath("components"), "size.mdx"), js: "", lang: "en" };
	const island = clients.length
		? Buffer.byteLength(await clientBundle(page, clients, new Set()))
		: 0;
	const size = sizeText(kitBytes(files) + island);
	return either ? size.replace(" KB", "+ KB") : size;
}

/** The bytes of kit files as a page carries them. */
const kitBytes = (files: string[]) =>
	files.reduce((sum, f) => sum + Buffer.byteLength(readKitText(kitPath(f))), 0);

/** A size as `kit` lists it, e.g. "16 KB". */
const sizeText = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** The size of kit files as a page carries them, e.g. "16 KB". */
const kitSize = (files: string[]) => sizeText(kitBytes(files));

/** A part of the kit other than a component: its `kit` line, the kit files a page using it carries, and its documentation. */
interface Feature {
	name: string;
	files: string[];
	/** The listing line; none when another feature's line names this one (the listing has no room for its own). */
	line?: string;
	doc: () => string;
}

/**
 * The features `kit` lists after the components, in that order, each one line long: the listing is what an author reads before
 * writing (about 17 lines), and `kit <name>` prints the rest. Pages include their scripts by themselves, so no line names a file.
 */
const FEATURES: Feature[] = [
	{
		name: "mermaid",
		files: [],
		line: "```mermaid fences: flowchart, state, sequence, class, ER, xychart; ```schematic: circuits as netlists (kit schematic). Drawn as SVG, each part with a data-ref.",
		doc: () => MERMAID_DOC,
	},
	{ name: "schematic", files: [], doc: () => SCHEMATIC_DOC },
	{
		name: "math.css",
		files: ["math.css"],
		line: "$x$ and $$...$$: TeX formulas drawn as MathML when you pack, no script; a formula sheet is a table of them.",
		doc: () => kitHeader("math.css"),
	},
	{
		name: "theme.css",
		files: ["theme.css"],
		line: "the warm-paper house style, light and dark: its classes and tokens.",
		doc: () => kitHeader("theme.css"),
	},
	{
		name: "link",
		files: ["link.js"],
		line: 'data-ref="cache" on your elements: those sharing a ref light up together.',
		doc: () => kitHeader("link.js"),
	},
	{
		name: "reply",
		files: ["reply.js"],
		line: "data-reply=\"Label\" on a panel of controls with ids: their values join the reader's reply, with the reader's notes.",
		doc: () => kitHeader("reply.js"),
	},
	{
		name: "keep",
		files: ["keep.js"],
		line: 'controls with ids keep their values across reloads; data-keep="off" leaves one out.',
		doc: () => kitHeader("keep.js"),
	},
	{
		name: "page",
		files: [],
		line: 'frontmatter, layout, tables, imports, your own "use client" components, typechecking.',
		doc: () => kitHeader("components/index.ts"),
	},
];

/** Components documented with another one: `kit Controls` prints Explore's, which Controls belongs to. */
const DOCUMENTED_WITH: Record<string, string> = { controls: "explore" };

/** The documentation `kit <topic>` prints: a component's (any case) or a feature's (kit:reply.js and reply.js name reply). */
function topicDoc(topic: string): string | undefined {
	const named = topic.replace(/^kit:/, "").replace(/\.js$/, "").toLowerCase();
	const key = DOCUMENTED_WITH[named] ?? named;
	const component = components().find((c) => c.name.toLowerCase() === key);
	if (component) {
		return kitHeader(component.file);
	}
	return FEATURES.find((f) => f.name === key || f.name === `${key}.css`)?.doc();
}

/**
 * What `kit labels` prints: the frontmatter `labels` key with every text the kit scripts add, in English and grouped by script,
 * so an author translates the values and pastes the block whole into a page's frontmatter. Values are JSON strings, which YAML
 * reads as they are, so a colon or quote in a translation needs no thought.
 */
function labelsBlock(): string {
	// A key two files share (expandAll) is written once, under the first: YAML takes each key once.
	const written = new Set<string>();
	return [
		"labels:",
		...kitLabels().flatMap(({ file, labels }) => {
			const lines = Object.entries(labels)
				.filter(([key]) => !written.has(key) && written.add(key))
				.map(([key, text]) => `  ${key}: ${JSON.stringify(text)}`);
			return lines.length ? [`  # kit ${file}`, ...lines] : [];
		}),
	].join("\n");
}

/** What `kit` prints: one line per component and feature, and how to read one. */
async function kitListing(): Promise<string> {
	const line = (name: string, size: string, text: string) =>
		`${name.padEnd(9)} ${size.padStart(6)}  ${text}`;
	return [
		'An .mdx page imports components from "kit" (import { Chart, View } from "kit"); pack adds the theme and the kit scripts it uses.',
		...(await Promise.all(
			components().map(async (c) => line(c.name, await componentSize(c.file), c.summary)),
		)),
		...FEATURES.filter((f) => f.line).map((f) =>
			line(f.name, f.files.length ? kitSize(f.files) : "", f.line ?? ""),
		),
		`Read one: ${CLI} kit <name>. The kit's texts are English: kit labels prints them to translate.`,
	].join("\n");
}

/**
 * `kit types`: prints the tsconfig for the .mdx pages in the current directory, and on stderr which files it covers, since a file
 * a page imports later needs a new one.
 */
async function types(): Promise<number> {
	const dir = process.cwd();
	if (!readdirSync(dir).some((name) => name.endsWith(".mdx"))) {
		return usage(
			"kit types makes a tsconfig.json for the .mdx pages in the current directory, and there are none: run it beside page.mdx",
		);
	}
	try {
		const sources = await pageSources(dir);
		console.log(authorTsconfig(dir, sources));
		console.error(
			sources.length
				? `kit types: checks ${sources.map((file) => relative(dir, file)).join(", ")} and the files they import; run it again when a page imports another file`
				: "kit types: the pages import no .ts or .tsx file, so there is nothing to check yet; run it again when one does",
		);
		return 0;
	} catch (e) {
		if (!(e instanceof PackError)) {
			throw e;
		}
		console.error(`error: ${e.message}`);
		return 1;
	}
}

/** One spec per command: drives dispatch, flag validation and --help. Exit codes: 0 ok, 1 problems found, 2 usage. */
export const COMMANDS: Record<string, Command> = {
	kit: {
		summary:
			"List what an .mdx page can use, one line per component and feature, or print one's documentation. kit types prints a tsconfig.json that typechecks the page's own .ts and .tsx files with bun check; kit labels prints the kit's texts as a frontmatter labels block to translate.",
		usage: "kit [<name> | types | labels]",
		flags: [],
		examples: ["kit", "kit Stepper", "kit page", "kit types > tsconfig.json", "kit labels"],
		run: async ([topic]) => {
			if (!topic) {
				console.log(await kitListing());
				return 0;
			}
			if (topic === "types") {
				return types();
			}
			if (topic === "labels") {
				console.log(labelsBlock());
				return 0;
			}
			const doc = topicDoc(topic);
			if (doc === undefined) {
				return usage(`the kit has no component or feature "${topic}". Run: ${CLI} kit`);
			}
			console.log(doc);
			return 0;
		},
	},
	pack: {
		summary:
			"Render an .mdx page into one HTML file that loads nothing: its CSS, images, fonts and the kit scripts it uses inlined, Mermaid fences drawn, code shipped only for client components. Fails on any network dependency.",
		usage: "pack <page.mdx> -o <artifact.html>",
		flags: ["-o <file>  output path (required)"],
		examples: ["pack page.mdx -o artifact.html"],
		run: async ([input], flags) => {
			const out = flags.get("-o")?.[0];
			if (!input || !out) {
				return usage("pack needs a page and -o. Example: pack page.mdx -o artifact.html");
			}
			if (extname(input).toLowerCase() !== ".mdx") {
				return usage(
					`pack takes an .mdx page, not "${input}": write the page as page.mdx (${CLI} kit lists what it can use)`,
				);
			}
			if (!existsSync(input)) {
				return usage(
					`pack needs an existing page, not "${input}". Example: pack page.mdx -o artifact.html`,
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
			"Open a packed file in headless Chrome: light+dark x desktop(1440)+narrow(390). Saves a first-viewport and a full-page PNG per theme and size, plus one full-page PNG per drill-down view and one PNG of an element per --do shot:<css>, into a fresh temp directory (printed) unless --out says where. Scrolls each page (and view) to its end and back before the full-page shots, so errors thrown by scroll handlers and IntersectionObserver callbacks are caught (at most 3 s per page). After each load and step it waits until the page has settled: fonts loaded, every visible chart drawn, and the timers of up to 1 s the page set have run; what is still missing after 10 s is a problem. Reports first-screen info, errors, network requests, overflow and ids on more than one element as problems (exit 1), and console warnings, tiny diagram text, content cut off inside an overflow:hidden box, a missing viewport meta, over-tall diagrams and charts, sideways-scrolling containers and steppers whose steps change only their captions as warnings. When Chrome fails to start or stops answering, or the run passes --timeout, check prints one error line and exits 1 with no report.",
		usage:
			"check <artifact.html> [--do <step>]... [--view <hash|all|none>]... [--quick] [--tag <name>] [--out dir] [--timeout <seconds>] [--json]",
		flags: [
			"--do <step>      run before the full-page shots, in order, repeatable. Its state persists into every saved full-page PNG (all themes and sizes); the first-viewport PNG is taken before it and drill-down views load fresh without it.\n                   click:<css>          first match (DOM click, element focused first)\n                   click:<css>@all      every match in turn, re-queried before each click (the output says how many)\n                   click:<css>@<n>      the n-th match, 0-based\n                   click:<x,y>          real mouse click at a point; use it for chart marks\n                   hover:<css | x,y>    real mouse move; fires :hover and chart tooltips (a tooltip is not in the full-page PNGs, which are taken after a relayout)\n                   focus:<css>          focus the first match, so key: reaches it\n                   key:<Key>            to the focused element: ArrowLeft/Right/Up/Down, Enter, Space, Escape, Tab, Home, End, Backspace, or one character; arrows move a focused range by its step and a select by one option\n                   type:<css>=<text>    type over the first match's text key by key (a newline presses Enter), then leave it, so input and change fire; type:#q= clears it\n                   set:<css>=<value>    set a range, select, date or other field's value at once, then fire input and change\n                   shot:<css>           PNG of the first match's box as the page is at this step (@all: each match; @<n>: that one), per theme and size, listed in the report\n                   reload               reload the page, keeping what it saved for the reader (kit keep); each load otherwise starts with empty storage\n                   Attribute values may be unquoted: [value=0] works. The value of type: and set: starts after the first = outside [...].",
			"--quick          light theme only, no first-viewport shots, no theme in PNG names (desktop.png, narrow.png); into --out (a temp directory without it)",
			"--view <what>    choose drill-down views to capture. The report lists every view hash found (links and static views) and which were captured. Default: the first hash of each view name, at most 6 names. --view all = every hash found (one PNG set each: slower). A hash (repo/mobile) captures exactly the hashes given; repeatable. none = overview only. Hashes only a script navigates to are never found: pass them as --view name/param.",
			"--tag <name>     add to the PNG names (a name, no path) so states do not overwrite each other; with --quick too (kind-desktop.png)",
			"--out <dir>      screenshot directory, created if missing (default: a new temp directory, printed in the report; nothing is written next to the file); a run that stops with an error writes nothing there",
			`--timeout <s>    stop after this many seconds, Chrome's start-up included (default ${DEFAULT_TIMEOUT_SECONDS}): Chrome is stopped, nothing is reported, and the error says where the run was`,
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
					`${file} still references ${unpacked.join(", ")}: check opens packed files. Run: pack page.mdx -o artifact.html, then check artifact.html`,
				);
			}
			const steps = flags.get("--do") ?? [];
			const bad = steps.map(stepError).find(Boolean);
			if (bad) {
				return usage(bad);
			}
			const timeout = flags.get("--timeout")?.[0];
			const timeoutSeconds = timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(timeout);
			if (!(timeoutSeconds > 0)) {
				return usage(`--timeout takes a number of seconds above 0, not "${timeout}"`);
			}
			// The tag becomes part of each PNG's file name, so a path in it would write outside --out (and outside staging).
			const tag = flags.get("--tag")?.[0] ?? "";
			if (/[\\/]/.test(tag) || tag === "." || tag === "..") {
				return usage(
					`--tag takes a name to add to file names, without a path separator, not "${tag}"`,
				);
			}
			const out = resolve(
				flags.get("--out")?.[0] ?? mkdtempSync(join(tmpdir(), "explainer-check-")),
			);
			const { shots, views, stepNotes } = await check(file, out, {
				steps,
				views: flags.get("--view") ?? [],
				tag,
				quick: flags.has("--quick"),
				timeoutSeconds,
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
