import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A page as an agent writes one: frontmatter, prose, a data import, a Mermaid fence and a client component that drives a Chart. */
const PAGE = `---
lang: de
labels:
  expandAll: Alle öffnen
---
import data from "./data.json";
import { Counter } from "./counter.tsx";
import "./page.css";

# Waits grow *fast*

The lede says what the page shows.

Simulated sample data

## The counter

Each click adds a bar.

<Counter start={data.start} />

## The mechanism

\`\`\`mermaid
flowchart TD
  clump[Clump] --> backlog[Backlog]
\`\`\`
`;

const COUNTER = `"use client";
import { useState } from "preact/hooks";
import { Chart } from "kit";

export function Counter({ start }: { start: number }) {
	const [n, setN] = useState(start);
	const bars = Array.from({ length: n }, (_, i) => i + 1);
	return (
		<figure class="fig">
			<button type="button" id="more" onClick={() => setN(n + 1)}>More</button>
			<output id="count">{n}</output>
			<Chart label="Bars" option={{ xAxis: { type: "category", data: bars.map(String) }, yAxis: {}, series: [{ type: "bar", data: bars }] }} />
		</figure>
	);
}
`;

/** Packs `source` as an .mdx page next to the counter and its data; returns the CLI result and the output path. */
async function packMdx(name: string, source: string) {
	dir.write("data.json", '{ "start": 3 }');
	dir.write("page.css", ".marker-page-css { color: var(--accent); }");
	dir.write("counter.tsx", COUNTER);
	const output = dir.path(`${name}.out.html`);
	return { result: await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]), output };
}

describe("an .mdx page packs to one prerendered file", () => {
	test("the static HTML holds the prose, the layout, the diagram and the island's first render", async () => {
		const { result, output } = await packMdx("page", PAGE);
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		const html = readFileSync(output, "utf8");
		expect(html).toContain('<html lang="de">');
		expect(html).toContain("<title>Waits grow fast</title>");
		expect(html).toMatch(
			/<div data-overview(="")?><header class="masthead"><h1>Waits grow <em>fast<\/em><\/h1><p class="lede">The lede says what the page shows.<\/p><p class="meta">Simulated sample data<\/p><\/header><section><h2>The counter<\/h2>/,
		);
		expect(html).toMatch(
			/<!--island:0--><figure class="fig">.*<output id="count">3<\/output><div class="chart" role="img" aria-label="Bars"><\/div><\/figure><!--\/island-->/,
		);
		expect(html).toContain('<div class="mermaid"><svg');
		expect(html).toContain(".marker-page-css");
		expect(html).toContain('var kitLabels = {"expandAll":"Alle öffnen"}');
		expect(html).not.toContain("<link");
		expect(html).not.toMatch(/<script src=[^>]*><\/script>/);
	});

	test("check finds no problems in light and dark, before and after a click on the island", async () => {
		const { output } = await packMdx("checked", PAGE);
		const checked = await runCli([
			"check",
			output,
			"--out",
			dir.path("shots"),
			"--do",
			"click:#more",
		]);
		expect(checked.stdout).toContain("0 problems");
		expect(checked.code).toBe(0);
	}, 60_000);

	test("a click on the island re-renders it and re-applies the chart's option", async () => {
		const { output } = await packMdx("clicked", PAGE);
		const state = await withPage(async (cdp) => {
			await cdp.send("Page.enable");
			const loaded = cdp.once("Page.loadEventFired");
			await cdp.send("Page.navigate", { url: `file://${output}` });
			await loaded;
			const read = `({ count: document.getElementById("count").textContent,
				bars: echarts.getInstanceByDom(document.querySelector(".chart")).getOption().series[0].data.length })`;
			// Preact runs effects after a frame; the second frame lets the chart apply the new option.
			return cdp.evaluate(
				// The load event has fired: the chart mounts once the fonts are in and its first resize callback has run.
				`document.fonts.ready
				.then(() => new Promise(requestAnimationFrame))
				.then(() => new Promise(requestAnimationFrame))
				.then(() => {
					const before = ${read};
					document.getElementById("more").click();
					return new Promise(requestAnimationFrame)
						.then(() => new Promise((done) => setTimeout(done)))
						.then(() => new Promise(requestAnimationFrame))
						.then(() => ({ before, after: ${read} }));
				})`,
				true,
			);
		});
		expect(state).toEqual({ before: { count: "3", bars: 3 }, after: { count: "4", bars: 4 } });
	}, 30_000);

	test("a bare data-* attribute is empty, as in HTML, wherever the JSX is, so reply.js labels a question by its legend", async () => {
		dir.write(
			"marked.tsx",
			`"use client";
import { useState } from "preact/hooks";

export function Marked() {
	const [late, setLate] = useState(false);
	return (
		<div data-early>
			<button type="button" id="late" onClick={() => setLate(true)}>Late</button>
			{late && <p data-late>Shown</p>}
		</div>
	);
}
`,
		);
		const { output } = await packMdx(
			"bare-data",
			`import { Marked } from "./marked.tsx";

# T

<fieldset data-reply><legend>Pick</legend><input type="radio" name="p" id="p" /></fieldset>

{["q"].map((q) => <fieldset data-reply id={q}><legend>Map</legend><input type="radio" name={q} id={\`\${q}-a\`} /></fieldset>)}

<Marked />
`,
		);
		const html = readFileSync(output, "utf8");
		expect(html).toMatch(/<fieldset data-reply(="")?><legend>Pick/);
		expect(html).toMatch(/<fieldset data-reply(="")? id="q"><legend>Map/);
		expect(html).toMatch(/<div data-early(="")?><button/);
		const values = await withPage(async (cdp) => {
			await cdp.send("Page.enable");
			const loaded = cdp.once("Page.loadEventFired");
			await cdp.send("Page.navigate", { url: `file://${output}` });
			await loaded;
			// The click makes new DOM after hydration; Preact renders it in a later frame.
			return cdp.evaluate(
				`document.getElementById("late").click(),
				new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done))).then(() =>
					["#q", "[data-early]", "[data-late]"].map((s) => document.querySelector(s)?.getAttribute(s === "#q" ? "data-reply" : s.slice(1, -1))))`,
				true,
			);
		});
		expect(values).toEqual(["", "", ""]);
	}, 30_000);
});

describe("pack fails on page source that would not work in the browser", () => {
	const failure = async (name: string, source: string) => {
		const { result } = await packMdx(name, source);
		expect(result.code).toBe(1);
		return result.stderr;
	};

	test("a function in a client component's props from the page names the prop path", async () => {
		const stderr = await failure(
			"function-prop",
			'import { Chart } from "kit";\n\n<Chart label="x" option={{ series: [{ label: { formatter: (p) => p } }] }} />\n',
		);
		expect(stderr).toContain(
			'<Chart option.series[0].label.formatter> is a function, but props from the page to a client component must be JSON or functions a "use client" module exports: export it from one, or render <Chart> in your own client component',
		);
	});

	test("a handler outside every client component says to add use client", async () => {
		const stderr = await failure("handler", "# T\n\n<button onClick={() => 1}>Go</button>\n");
		expect(stderr).toContain(
			'<button onClick> in the page is static HTML, so the handler would never run: move it into a component of your own in a .tsx module whose first line is "use client"',
		);
	});

	test("a handler prop on a static component fails, and other function props do not", async () => {
		const tree =
			'import { Tree } from "kit";\n\n<Tree items={[{ name: "a" }]} row={(r) => ({ label: r.name, text: "t" })} />\n';
		expect((await packMdx("static-function", tree)).result.code).toBe(0);
		const stderr = await failure(
			"component-handler",
			'import { Stepper } from "kit";\n\n<Stepper captions={["a", "b"]} onStep={() => 1}><svg /></Stepper>\n',
		);
		expect(stderr).toContain(
			'<Stepper onStep> in the page is static HTML, so the handler would never run: move it into a component of your own in a .tsx module whose first line is "use client"',
		);
	});

	test("a ref that is a name, not a Preact ref, says to write data-ref; refs in a client component pack", async () => {
		dir.write(
			"refs.tsx",
			`"use client";
import { useRef } from "preact/hooks";

export function Box({ ref: _unused }: { ref?: string }) {
	return <b>box</b>;
}

export function Refs() {
	const held = useRef<HTMLElement>(null);
	return <p ref={held}><span ref={(el) => el?.focus()}>Refs</span></p>;
}
`,
		);
		expect(
			(await packMdx("refs", 'import { Refs } from "./refs.tsx";\n\n<Refs />\n')).result.code,
		).toBe(0);
		expect(await failure("ref-element", '# T\n\n<span ref="flow">Flow</span>\n')).toContain(
			'<span ref="flow"> in the page: ref is Preact\'s handle to the element (a function or useRef()) and never reaches the page; to link the part with others, write data-ref="flow"',
		);
		expect(
			await failure("ref-component", 'import { Box } from "./refs.tsx";\n\n<Box ref="flow" />\n'),
		).toContain("or give Box's prop another name");
	});

	test("an id on two elements names the id and where each is", async () => {
		const stderr = await failure(
			"repeated-id",
			'# Plan\n\n## Work list\n\n<details id="opt-O2"><summary>O2</summary>Tasks</details>\n\n## Options\n\n<label><input type="checkbox" id="opt-O2" /> O2</label>\n',
		);
		expect(stderr).toContain(
			'the id "opt-O2" is on 2 elements: <details> under "Work list", <input type="checkbox"> under "Options". A script, a label\'s for, a #link and a check --do step find only the first: give each its own id',
		);
	});

	test("children from the page into a client component are refused", async () => {
		const stderr = await failure(
			"children",
			'import { Counter } from "./counter.tsx";\n\n<Counter start={1}>Text</Counter>\n',
		);
		expect(stderr).toContain(
			"<Counter> has children in the page, but a client component takes JSON props only",
		);
	});

	test("a label key no kit script reads names the key, which would otherwise stay English", async () => {
		const stderr = await failure(
			"label-key",
			"---\nlabels:\n  expandAl: Alle öffnen\n---\n\n# T\n",
		);
		expect(stderr).toContain(
			'label-key.mdx frontmatter: the kit has no label "expandAl"; kit labels prints every key with its English text',
		);
	});

	test("an MDX syntax error names file, line and column", async () => {
		const stderr = await failure("syntax", "# T\n\nan {open expression\n");
		expect(stderr).toMatch(/syntax\.mdx:3:\d+: /);
	});
});
