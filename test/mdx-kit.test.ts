import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ENGLISH, labelsScript, SLOVENIAN } from "./labels-contract.ts";
import { pageAssertion, pageContract, runCli, runPacked, SETTLED, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PLAN = {
	people: [
		{ id: "ana", name: "Ana Novak", role: "Leads the firmware work.", hours: 52 },
		{ id: "luka", name: "Luka Kos", role: "Builds the boards.", hours: 34 },
		{ id: "mia", name: "Mia Zupan", role: "Tests everything.", hours: 20 },
	],
	phases: [
		{
			id: "p1",
			name: "1 Discovery",
			hours: 52,
			tasks: [
				{
					id: "spike",
					name: "1.1 Spike boards",
					hours: 52,
					tasks: [
						{
							name: "1.1.1 Schematic review",
							hours: 12,
							owner: "Ana",
							ref: "ana",
							note: "Walk the old schematic.",
						},
						{
							name: "1.1.2 Power stage",
							hours: 24,
							owner: "Mia",
							ref: "mia",
							note: "Build the buck stage.",
						},
						{ name: "1.1.3 Enclosure fit", hours: 16, owner: "Luka", ref: "luka", view: "luka" },
					],
				},
			],
		},
		{
			id: "p2",
			name: "2 Firmware",
			hours: 20,
			tasks: [
				{
					name: "2.1 HAL and clocks",
					hours: 20,
					owner: "Ana",
					ref: "ana",
					note: "Bring up the clocks.",
				},
			],
		},
	],
};

/** A page as an agent writes one with the kit's static components: a view per person from data, a tree, a table, a question. */
const PAGE = (script = "") => `import plan from "./plan.json";
import { Question, Tree, View } from "kit";

# The board ships in 72 hours

Two phases, three people, one decision left.

<h2 data-nav="People">Three people share the work, <em>Ana</em> most of it</h2>

<ul>{plan.people.map((p) => <li><a href={\`#person/\${p.id}\`}>{p.name}</a>: {p.hours} h, <span data-ref={p.id}>{p.id}</span></li>)}</ul>

<h2 data-nav="Plan">The plan has two phases and 72 hours</h2>

<Tree cols="4rem 4rem" head={["Task", "Hours", "Owner"]} items={plan.phases} row={(r) => ({ label: r.name, cells: [\`\${r.hours} h\`, r.owner], items: r.tasks, text: r.note, href: r.view && \`#person/\${r.view}\`, id: r.id, ref: r.ref })} />

## Options

See [the method](#about).

| Option | What it means | Delay |
|---|:---|---:|
| A. Ship now | Spike boards go out as they are. | 0 weeks |
| B. One more spin | A second board revision first. | 2 weeks |

<Question name="ship" legend="Which option should we take?" options={{ a: "Ship now", b: "One more spin" }} />

{plan.people.map((p) => (
  <View name="person" param={p.id} back="The board">
    <h1>{p.name}</h1>
    <p>{p.role}</p>
    <section><h2>Hours</h2><p>{p.hours} h this quarter.</p></section>
  </View>
))}

<View name="about" back="The board">

# How the hours were counted

From the work list.

## Sources

The work list.

</View>
${script}`;

/** The same content as PAGE, written by hand as a v0.8 page: what PAGE must render to. */
const V08_MAIN = `<main class="page"><div data-overview>
<header class="masthead"><h1>The board ships in 72 hours</h1><p class="lede">Two phases, three people, one decision left.</p></header>
<section data-nav="People"><h2>Three people share the work, <em>Ana</em> most of it</h2>
<ul><li><a href="#person/ana">Ana Novak</a>: 52 h, <span data-ref="ana">ana</span></li><li><a href="#person/luka">Luka Kos</a>: 34 h, <span data-ref="luka">luka</span></li><li><a href="#person/mia">Mia Zupan</a>: 20 h, <span data-ref="mia">mia</span></li></ul></section>
<section data-nav="Plan"><h2>The plan has two phases and 72 hours</h2>
<div class="tree" style="--tree-cols: 4rem 4rem">
<div class="tree-head"><span>Task</span><span>Hours</span><span>Owner</span></div>
<details id="p1"><summary><span>1 Discovery</span><span>52 h</span><span></span></summary>
	<details id="spike"><summary><span>1.1 Spike boards</span><span>52 h</span><span></span></summary>
		<details><summary data-ref="ana"><span>1.1.1 Schematic review</span><span>12 h</span><span>Ana</span></summary><p>Walk the old schematic.</p></details>
		<details><summary data-ref="mia"><span>1.1.2 Power stage</span><span>24 h</span><span>Mia</span></summary><p>Build the buck stage.</p></details>
		<a href="#person/luka" data-ref="luka"><span>1.1.3 Enclosure fit</span><span>16 h</span><span>Luka</span></a>
	</details>
</details>
<details id="p2"><summary><span>2 Firmware</span><span>20 h</span><span></span></summary>
	<details><summary data-ref="ana"><span>2.1 HAL and clocks</span><span>20 h</span><span>Ana</span></summary><p>Bring up the clocks.</p></details>
</details>
</div></section>
<section><h2>Options</h2><p>See <a href="#about">the method</a>.</p>
<table class="compare"><thead><tr><th>Option</th><th>What it means</th><th class="num">Delay</th></tr></thead><tbody>
<tr><th scope="row">A. Ship now</th><td data-label="What it means">Spike boards go out as they are.</td><td class="num" data-label="Delay">0 weeks</td></tr>
<tr><th scope="row">B. One more spin</th><td data-label="What it means">A second board revision first.</td><td class="num" data-label="Delay">2 weeks</td></tr>
</tbody></table>
<fieldset data-reply=""><legend>Which option should we take?</legend><div class="seg">
<label><input type="radio" name="ship" value="a" id="ship-a"><span>Ship now</span></label>
<label><input type="radio" name="ship" value="b" id="ship-b"><span>One more spin</span></label>
</div></fieldset></section></div>
${PLAN.people
	.map(
		(
			p,
		) => `<section class="view" data-view="person/${p.id}"><div class="view-head"><a class="back" href="#">The board</a><h1>${p.name}</h1><p class="lede">${p.role}</p></div>
<section><h2>Hours</h2><p>${p.hours} h this quarter.</p></section></section>`,
	)
	.join("\n")}
<section class="view" data-view="about"><div class="view-head"><a class="back" href="#">The board</a><h1>How the hours were counted</h1><p class="lede">From the work list.</p></div>
<section><h2>Sources</h2><p>The work list.</p></section></section></main>`;

/** Packs `source` as `<name>.mdx` beside plan.json; returns the CLI result and the output path. */
async function packMdx(name: string, source: string, files: Record<string, string> = {}) {
	dir.write("plan.json", JSON.stringify(PLAN));
	for (const [file, text] of Object.entries(files)) {
		dir.write(file, text);
	}
	const output = dir.path(`${name}.out.html`);
	return { result: await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]), output };
}

/** The page's `<main>`, with the whitespace between tags dropped, and void tags and empty attributes written one way. */
const mainOf = (html: string) =>
	(/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "")
		.replace(/>\s+</g, "><")
		.replace(/\s*\/>/g, ">")
		.replace(/=""/g, "");

describe("the kit's static components render a v0.8 page", () => {
	test("View, Tree, Question, a Markdown table and an <h2 data-nav> render the markup a v0.8 author writes", async () => {
		const { result, output } = await packMdx("parity", PAGE());
		expect(result.code).toBe(0);
		expect(mainOf(readFileSync(output, "utf8"))).toBe(mainOf(V08_MAIN));
	});

	test("check --view all finds no problems in light and dark, on desktop and phone", async () => {
		const { output } = await packMdx("checked", PAGE());
		const checked = await runCli(["check", output, "--view", "all", "--out", dir.path("shots")]);
		expect(checked.stdout).toContain("Views captured (4)");
		expect(checked.stdout).toContain("0 problems");
		expect(checked.code).toBe(0);
	}, 90_000);

	test("the views navigate with crumbs, previous/next and a rail named by data-nav; Expand all opens the tree; the reply holds the answer", async () => {
		const contract = `${SETTLED_PAGE}
var contract = settled.then(async () => {
	const failures = [];
	const expect = (ok, name) => ok || failures.push(name);
	expect(texts("#toc-list > li > a") === "The board|People|Plan|Options", "the rail: " + texts("#toc-list > li > a"));
	$("section[data-nav=Plan] .fold-all").click();
	expect([...document.querySelectorAll(".tree details")].every((d) => d.open), "Expand all opens every level of the tree");
	await navigated(() => $("a[href='#person/luka']").click());
	const view = $(".view.active");
	expect(texts(".view.active .crumbs li") === "The board|Luka Kos", "crumbs: " + texts(".view.active .crumbs li"));
	expect(view.querySelector(".sibs [rel=prev]")?.getAttribute("href") === "#person/ana" && view.querySelector(".sibs [rel=next]")?.getAttribute("href") === "#person/mia", "previous/next walk the people");
	await navigated(() => history.back());
	$("#ship-b").click();
	$(".reply-bar .primary").click();
	expect($(".reply-md").textContent.includes("One more spin"), "the reply holds the answer: " + $(".reply-md").textContent);
	$(".reply-dialog").close();
	return failures;
});`;
		const { result, output } = await packMdx(
			"navigate",
			PAGE('<script src="contract.js"></script>'),
			{
				"contract.js": contract,
			},
		);
		expect(result.code).toBe(0);
		expect(await runPacked(output)).toEqual([]);
	}, 60_000);

	test("a Table from records renders what the same Markdown table does, numbers written for the page's lang", async () => {
		const { result, output } = await packMdx(
			"table",
			`---
lang: sl
---
import { Table } from "kit";

# Fixes

| Fix | Busy | Wait | Cost |
|---|---:|---:|---|
| Second barista | 45,0&nbsp;% | 0,5 | 12.345&nbsp;€ |
| Change nothing | 90,0&nbsp;% | 18,0 | none |

<Table rows={[{ name: "Second barista", busy: 0.45, wait: 0.5, cost: 12345 }, { name: "Change nothing", busy: 0.9, wait: 18, cost: "none" }]} cols={[{ head: "Fix", value: "name" }, { head: "Busy", value: "busy", format: { percent: true, digits: 1 } }, { head: "Wait", value: (f) => f.wait, format: { digits: 1 } }, { head: "Cost", value: (f) => typeof f.cost === "number" ? \`\${f.cost.toLocaleString("sl")}\u00a0€\` : f.cost }]} />

<Table id="linked" rows={[{ id: "second", name: "Second barista", why: "Halves the load", wait: 0.5 }, { id: "none", name: "Change nothing", why: "", wait: 18 }]} state={(f) => (f.id === "none" ? "out" : "fit")} cols={[{ head: "Fix", value: "name", link: (f) => \`#fix/\${f.id}\`, note: "why" }, { head: "Wait", value: "wait", format: { unit: "min" } }]} />
`,
		);
		expect(result.stderr).toBe("");
		const [markdown, table, linked] = mainOf(readFileSync(output, "utf8")).match(
			/<table[\s\S]*?<\/table>/g,
		) ?? [""];
		expect(table).toBe(markdown);
		expect(`<main>${linked}</main>`).toBe(
			mainOf(`<main><table class="compare" id="linked"><thead><tr><th>Fix</th><th class="num">Wait</th></tr></thead><tbody>
<tr data-state="fit"><th scope="row"><a href="#fix/second">Second barista</a><span class="why">Halves the load</span></th><td class="num" data-label="Wait">0,5\u00a0min</td></tr>
<tr data-state="out"><th scope="row"><a href="#fix/none">Change nothing</a></th><td class="num" data-label="Wait">18\u00a0min</td></tr>
</tbody></table></main>`),
		);
	});

	test("a View inside another View fails the pack, saying where views go", async () => {
		const { result } = await packMdx(
			"nested",
			'import { View } from "kit";\n\n<View name="a">\n\n# A\n\n<View name="b">\n\n# B\n\n</View>\n\n</View>\n',
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("a View is inside another View");
	});
});

/** support.ts's SETTLED, and helpers for a contract script: `$`, `texts` and `navigated`. */
const SETTLED_PAGE = `${SETTLED}
const $ = (selector) => document.querySelector(selector);
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent).join("|");
const navigated = (go) => new Promise((shown) => { addEventListener("hashchange", shown, { once: true }); go(); });`;

/**
 * The counterpart of labels.test.ts for an .mdx page: lang and labels from the frontmatter, the same components (a stepper, two
 * kinds of view without a .back link, two folds, a question, three note parts) and the same contract.
 */
const LABELS_PAGE = `---
lang: sl
labels:
${Object.entries(SLOVENIAN)
	.map(([key, text]) => `  ${key}: ${JSON.stringify(text)}`)
	.join("\n")}
---
import { Question, Tree, View } from "kit";

# Labels

<div>A <span data-ref="loose">loose</span> part.</div>

## People

<a href="#p/a">A</a> <a href="#p/b">B</a>

<Tree items={[{ label: "One", text: "1" }, { label: "Two", text: "2" }]} />

## Items

<a href="#i/1">One</a>, and the <span data-ref="cache">cache</span>.

<figure aria-label="Scheme"><p>The <span data-ref="db">db</span>.</p></figure>

<Question name="p" legend="Pick" options={{ a: "A", b: "B" }} />

<figure class="fig" id="s" data-stepper><svg viewBox="0 0 50 20" width="150"><rect data-step="1" width="20" height="20" /><rect data-step="2" x="30" width="20" height="20" /></svg><ol data-captions><li>one</li><li>two</li></ol></figure>

<View name="p">

# Person

</View>

<View name="i">

# Item

</View>

<script src="labels.js"></script>
`;

test("an .mdx page with lang and labels in its frontmatter shows every kit text in its language", async () => {
	expect(Object.keys(SLOVENIAN)).toEqual(Object.keys(ENGLISH));
	const { result, output } = await packMdx("labels", LABELS_PAGE, {
		"labels.js": labelsScript(SLOVENIAN),
	});
	expect(result.stderr).toBe("");
	expect(readFileSync(output, "utf8")).toContain('<html lang="sl">');
	expect(await runPacked(output, { slowdown: 4 })).toEqual([]);
}, 60_000);

test("MDX records keep JSX category markers, a plain toolbar's Expand all, and numeric table alignment at 390px", async () => {
	const source = `import { Tree } from "kit";

# Records

## Tasks

<div class="toolbar"><input type="search" aria-label="Search" /><select aria-label="Owner"><option>All owners</option></select></div>

<p class="legend"><span class="chip" style="--swatch: var(--c2)"><i></i>Firmware</span></p>

<Tree cols="minmax(0, 4rem) minmax(0, 5rem)" head={["Task", "Hours", "Type"]} items={[
  { label: <span class="chip" style="--swatch: var(--c2)"><i></i>Firmware</span>, cells: [70, null], items: [
    { label: "Clocks", cells: [12, <span class="chip" style="--swatch: var(--c2)"><i></i>FW</span>], text: "Bring up the clocks." }
  ] }
]} />

| Task | Hours |
|---|---:|
| Clocks | 12 |

<script src="records.js"></script>
`;
	const script = pageContract({
		"Expand all joins the plain toolbar": `document.querySelector(".toolbar").lastElementChild.matches(".fold-all")`,
		"Expand all opens every row": `(document.querySelector(".fold-all").click(), [...document.querySelectorAll(".tree details")].every((d) => d.open))`,
		"labels and cells keep their category words": `[...document.querySelectorAll(".tree .chip")].map((c) => c.textContent).join() === "Firmware,FW"`,
		"the legend and the rows use the same swatch": `new Set([...document.querySelectorAll(".chip i")].map((i) => getComputedStyle(i).backgroundColor)).size === 1`,
		"only the right-aligned column is numeric": `document.querySelectorAll(".compare .num").length === 2 && document.querySelector(".compare th.num") && document.querySelector(".compare td.num[data-label=Hours]")`,
		"numeric alignment follows the kit on phones": `getComputedStyle(document.querySelector(".compare td.num")).textAlign === (innerWidth < 640 ? "start" : "end")`,
		"nothing scrolls sideways": `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	});
	const { result, output } = await packMdx("records", source, { "records.js": script });
	expect(result.code).toBe(0);
	expect(await runPacked(output)).toEqual([]);
}, 30_000);

/** The study pattern of guide.md as an author writes it in MDX: an explanation in a textarea, the answer in a <details> after it. */
const STUDY_PAGE = `import { Question } from "kit";

# Study

## Why does the queue grow?

<Question name="q1" legend="Which load makes the wait explode?" options={{ half: "50%", most: "90%" }} />

<fieldset data-reply>
<legend>Explain in one sentence why.</legend>
<textarea id="q1-why" aria-label="Why"></textarea>
</fieldset>

<details>
<summary>Answer</summary>

At **90%** load the wait is *nine* service times.

- one idle slot absorbs a burst

</details>

<script src="study.js"></script>
`;

test("the study pattern works as written in MDX: the reply holds the explanation, a reload keeps it, the answer's Markdown renders", async () => {
	const probe = (name: string, body: string) =>
		pageAssertion("study contract", name, `sessionStorage.loads !== "2" || (${body})`);
	const script = `sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;
const why = () => document.getElementById("q1-why");
${probe("the reload restores the explanation", 'why().value === "q"')}
${probe("the reply holds the explanation", '(document.querySelector(".reply-bar .primary").click(), document.querySelector(".reply-md").textContent.includes("q"))')}
${probe("the answer's Markdown renders", 'document.querySelector("details strong")?.textContent === "90%" && document.querySelector("details em") && document.querySelector("details li")')}`;
	const { result, output } = await packMdx("study", STUDY_PAGE, { "study.js": script });
	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).toContain(
		'<fieldset data-reply><legend>Explain in one sentence why.</legend><textarea id="q1-why"',
	);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("study-shots"),
		...["focus:#q1-why", "key:q", "reload"].flatMap((step) => ["--do", step]),
	]);
	expect(checked.stdout).not.toContain("study contract");
	expect(checked.code).toBe(0);
}, 60_000);
