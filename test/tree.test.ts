import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, SETTLED, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main class="page">`;

/** A three-level tree: two phases, a group, leaves that open in place and one that links to its view; the view has a tree too. */
const TREE = `<div class="tree" id="plan">
<details id="p1"><summary><span>1 Discovery</span><span>3 tasks</span><span>52 h</span></summary>
	<details id="spike"><summary><span>1.1 Spike boards</span><span>3 tasks</span><span>52 h</span></summary>
		<details id="t111"><summary data-ref="ana"><span>1.1.1 Schematic review</span><span></span><span>12 h</span></summary><p id="t111-text">Walk the old schematic.</p></details>
		<details><summary data-ref="mia"><span>1.1.2 Power stage spike with a label long enough to wrap on a phone</span><span></span><span>24 h</span></summary><p>Build the buck stage.</p></details>
		<a href="#task/113" data-ref="ana"><span>1.1.3 Enclosure fit</span><span></span><span>16 h</span></a>
	</details>
</details>
<details id="p2"><summary><span>2 Firmware</span><span>1 task</span><span>20 h</span></summary>
	<details><summary data-ref="luka"><span>2.1 HAL and clocks</span><span></span><span>20 h</span></summary><p id="t21-text">Bring up clocks.</p></details>
</details>
</div>`;

const TREE_PAGE = (script: string) => `${HEAD}<div data-overview><h1>Plan</h1>
<section><h2>Story</h2><p><a id="to-spike" href="#spike">Spike boards: 3 tasks, 52 h</a>, <span data-ref="ana">Ana</span>, <span data-ref="luka">Luka</span></p>
<div style="block-size: 2000px"></div></section>
<section id="plan-section"><h2>Plan</h2>${TREE}<div style="block-size: 2000px"></div></section></div>
<section class="view" data-view="task"><a class="back" href="#">Plan</a><h1>Task</h1><a id="to-flash" href="#flash">Flashing</a>
<div style="block-size: 2000px"></div><div class="tree"><details><summary><span>Prepare</span><span>2 h</span></summary>
<details><summary><span>Order parts</span><span>1 h</span></summary><p>Usual supplier.</p></details>
<details id="flash"><summary><span>Flash the board</span><span>1 h</span></summary><p id="flash-text">Bench programmer.</p></details></details></div>
<div style="block-size: 2000px"></div></section></main>
<script src="kit:views.js"></script>
<script src="kit:link.js"></script>
<script>
${SETTLED}
const $ = (selector) => document.querySelector(selector);
const navigated = (go) => new Promise((shown) => { addEventListener("hashchange", shown, { once: true }); go(); });
const frame = () => new Promise(requestAnimationFrame);
const atTop = (el) => Math.abs(el.getBoundingClientRect().top) <= 2;
const shows = (id) => document.getElementById(id).checkVisibility();
const tinted = (el) => getComputedStyle(el).backgroundColor !== getComputedStyle($(".tree")).backgroundColor;
const plan = () => [...document.querySelectorAll("#plan details")];
var contract = settled.then(async () => {
	const failures = [];
	const expect = (ok, name) => { if (!ok) failures.push(name); };
${script}
	return failures;
});
</script></body></html>`;

test("Expand all opens and closes every level of a tree", async () => {
	const script = `
	const button = $("#plan-section > .fold-all");
	expect(button?.nextElementSibling?.id === "plan", "the tree's section gets Expand all, just above the tree");
	button.click();
	expect(plan().every((d) => d.open) && shows("t111-text") && button.textContent === "Collapse all", "Expand all opens every level");
	button.click();
	expect(plan().every((d) => !d.open) && button.textContent === "Expand all", "Collapse all closes every level");`;
	expect(await packAndRun(dir, "expand", TREE_PAGE(script))).toEqual([]);
}, 30_000);

test("a tree's numbers line up across rows and levels, on desktop and phone", async () => {
	const script = `
	$("#plan-section > .fold-all").click();
	const rows = [...document.querySelectorAll("#plan summary, #plan a")];
	const edges = (n) => new Set(rows.map((row) => Math.round(row.children[n].getBoundingClientRect().right)));
	expect(edges(1).size === 1 && edges(2).size === 1, "each number column has one right edge: " + [...edges(1)] + " / " + [...edges(2)]);
	const end = (row) => Math.round(row.getBoundingClientRect().right);
	expect(rows.every((row) => Math.round(row.children[2].getBoundingClientRect().right) === end(row)), "the last column ends at the row's end");
	const label = (row) => row.children[0].getBoundingClientRect();
	expect(label(rows[2]).left > label(rows[1]).left && label(rows[1]).left > label(rows[0]).left, "each level is indented");
	expect(Math.round(label(rows[4]).left) === Math.round(label(rows[2]).left), "a link row's label starts with its sibling folds' labels");`;
	expect(await packAndRun(dir, "align", TREE_PAGE(script))).toEqual([]);
}, 30_000);

test("--tree-cols sizes each column, and the head names them over the cells, on desktop and phone", async () => {
	const row = (label: string, cells: string) =>
		`<span>${label}</span>${cells
			.split(" ")
			.map((cell) => `<span>${cell}</span>`)
			.join("")}`;
	const page = `${HEAD}<h1>Columns</h1>
<div class="tree" id="cols" style="--tree-cols: 3rem 4.5rem 3rem 3.5rem">
<div class="tree-head">${row("Task", "Hours Owner Low High")}</div>
<details open><summary>${row("1 Discovery", "52h Ana 40h 70h")}</summary>
	<details open><summary>${row("1.1 Spike boards", "52h Ana 40h 70h")}</summary>
		<details><summary>${row("1.1.1 Schematic review", "12h Ana 10h 16h")}</summary><p>Walk the old schematic.</p></details>
		<a href="#t">${row("1.1.2 Power stage", "40h Mia 30h 54h")}</a>
	</details>
</details>
</div></main>
<script>
const rows = [...document.querySelectorAll("#cols summary, #cols a")];
const head = document.querySelector(".tree-head");
const box = (el) => el.getBoundingClientRect();
const edges = (n) => new Set([head, ...rows].map((r) => Math.round(box(r.children[n]).right)));
const widths = [1, 2, 3, 4].map((n) => Math.round(box(head.children[n]).width));
${pageContract({
	"each column has its template width": `widths.join() === [48, 72, 48, 56].join()`,
	"each column has one right edge, the head's included": `[1, 2, 3, 4].every((n) => edges(n).size === 1)`,
	"the head's label starts with the top level's labels": `Math.round(box(head.children[0]).left) === Math.round(box(rows[0].children[0]).left)`,
	"on a phone the numbers take the line under the label, on a wide screen the label's line": `rows.every((r) => (box(r.children[1]).top > box(r.children[0]).bottom - 1) === (innerWidth < 640))`,
	"nothing scrolls sideways": `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
})}</script></body></html>`;
	expect(await packAndRun(dir, "columns", page)).toEqual([]);
}, 30_000);

test("a toolbar is one row on a wide screen, whole rows on a phone, and takes the records' Expand all", async () => {
	const page = `${HEAD}<h1>Records</h1><section id="records"><h2>Tasks</h2>
<div class="toolbar" id="bar">
	<div class="seg"><label><input type="radio" name="v" checked><span>Tree</span></label><label><input type="radio" name="v"><span>People</span></label></div>
	<input type="search" aria-label="Search"><select aria-label="Owner"><option>All owners</option></select><select aria-label="Type"><option>All types</option></select>
</div>
${TREE}</section></main>
<script src="kit:views.js"></script>
<script>
const bar = document.getElementById("bar");
const box = (el) => el.getBoundingClientRect();
const [seg, search, owner, type] = bar.children;
${pageContract({
	"Expand all ends the toolbar": `bar.lastElementChild.matches(".fold-all")`,
	"on a wide screen every control shares one row": `innerWidth < 640 || [...bar.children].every((c) => Math.abs(box(c).top + box(c).height / 2 - box(seg).top - box(seg).height / 2) < 1)`,
	"the switch is as tall as the inputs": `Math.round(box(seg).height) === Math.round(box(search).height)`,
	"on a phone the switch and the search span the row and the filters pair up": `innerWidth >= 640 || ([seg, search].every((c) => Math.abs(box(c).width - box(bar).width) < 1) && box(owner).top === box(type).top && Math.abs(box(owner).width - box(type).width) < 1)`,
	"nothing scrolls sideways": `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
})}</script></body></html>`;
	expect(await packAndRun(dir, "toolbar", page)).toEqual([]);
}, 30_000);

test("a link into a branch opens it and its ancestors and scrolls to it, on the overview and in a view", async () => {
	const script = `
	await navigated(() => $("#to-spike").click());
	await frame();
	expect($("#p1").open && $("#spike").open && !$("#p2").open && atTop($("#spike")), "a link to a branch opens it and its ancestors, at the top");
	$("#spike").open = false;
	$("#to-spike").click();
	await frame();
	expect($("#spike").open, "following the same link again reopens the branch the reader closed");
	await navigated(() => $("#spike a[href='#task/113']").click());
	expect($(".view.active .crumbs [aria-current]")?.textContent === "1.1.3 Enclosure fit", "a row link's label, not its numbers, names its view");
	await navigated(() => $("#to-flash").click());
	await frame();
	expect(document.documentElement.classList.contains("in-view") && $("#flash").open && shows("flash-text") && atTop($("#flash")), "in a view, a link to a branch of its tree opens it and stays in the view");
	await navigated(() => history.back());
	await navigated(() => history.forward());
	await frame();
	expect(document.documentElement.classList.contains("in-view") && $("#flash").open, "Back and Forward return to the branch in its view");`;
	expect(await packAndRun(dir, "branch", TREE_PAGE(script))).toEqual([]);
}, 30_000);

test("a closed branch shows it holds a row lit by data-ref", async () => {
	const script = `
	const [p1, p2] = [$("#p1 > summary"), $("#p2 > summary")];
	expect(!tinted(p1) && !tinted(p2), "no branch is tinted before anything is lit");
	$("span[data-ref=ana]").click();
	await frame();
	expect(tinted(p1) && !tinted(p2), "lighting Ana tints the closed phase holding Ana's rows, not the other");
	$("#p1").open = true;
	await frame();
	expect(!tinted(p1) && tinted($("#spike > summary")), "once open, the phase is plain and the closed group inside it is tinted");`;
	expect(await packAndRun(dir, "lit", TREE_PAGE(script))).toEqual([]);
}, 30_000);

test("closed folds print open", async () => {
	const page = `${HEAD}<h1>Print</h1>
<details><summary>Plain</summary><p id="plain">Plain fold</p></details>
<details><summary>Outer</summary><details><summary>Inner</summary><p id="deep">Deep fold</p></details></details></main>
<script>${pageContract({
		"a closed fold's text prints": `document.getElementById("plain").checkVisibility()`,
		"a fold inside a closed fold prints": `document.getElementById("deep").checkVisibility()`,
	})}</script></body></html>`;
	expect(await packAndRun(dir, "print", page, 1, "print")).toEqual([]);
}, 30_000);
