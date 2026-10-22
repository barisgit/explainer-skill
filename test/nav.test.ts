import { afterAll, expect, test } from "bun:test";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body>`;

/** People link to their own items in their own order; the overview links people with a generic "Open" and every item by name. */
const NESTED = (
	script: string,
) => `${HEAD}<main class="page"><div data-overview><h1>Nested views</h1>
<section><h2>People</h2><p><a href="#p/a">Open</a> <a href="#p/b">Open</a></p></section>
<section><h2>Items</h2><p><a href="#i/1">One</a> <a href="#i/2">Two</a> <a href="#i/3">Three</a> <a href="#i/4">Four</a></p></section>
</div>
<section class="view" data-view="p"><div class="view-head"><a class="back" href="#">Home</a><h1></h1></div><p class="mine"></p></section>
<section class="view" data-view="i"><div class="view-head"><a class="back" href="#">Home</a><h1></h1></div></section></main>
<script src="kit:views.js"></script>
<script>
Views.on("p", (el, p) => {
	el.querySelector("h1").textContent = "Person " + p.toUpperCase();
	el.querySelector(".mine").innerHTML = p === "a" ? '<a href="#i/4">Four</a> <a href="#i/2">Two</a>' : "";
});
Views.on("i", (el, p) => { el.querySelector("h1").textContent = "Item " + p; });
sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent).join("|");
const view = () => document.querySelector(".view.active");
const sibs = (rel) => view().querySelector(".sibs [rel=" + rel + "]")?.getAttribute("href") ?? "none";
const count = () => view().querySelector(".sibs .count")?.textContent;
const sub = (n) => texts(".toc #toc-list > li:nth-child(" + n + ") ol a");
${script}
</script></body></html>`;

const contract = (name: string, body: string) => pageAssertion("nav contract", name, body);

const run = async (name: string, page: string, args: string[]) => {
	const output = dir.path(`${name}.out.html`);
	const packed = await runCli(["pack", dir.write(`${name}.html`, page), "-o", output]);
	const checked = await runCli(["check", output, "--quick", "--out", dir.path(name), ...args]);
	expect(packed.code).toBe(0);
	expect(checked.stdout).not.toContain("nav contract");
	expect(checked.code).toBe(0);
};

test("the trail and previous/next follow the view the reader came from, and survive a reload", async () => {
	const script = `
${contract("a page with views inside views has a rail of its sections", `location.hash || (document.documentElement.classList.contains("has-toc") && texts("#toc-list > li > a") === "Home|People|Items")`)}
${contract("after a reload the trail names each step, a generic link text giving way to the view's heading", `sessionStorage.loads !== "2" || texts(".view.active .crumbs li") === "Home|Person A|Four"`)}
${contract("the view's own .back link stays, as the first crumb", `!location.hash || (view().querySelectorAll(".back").length === 1 && view().querySelector(".crumbs li:first-child > .back"))`)}
${contract("after a reload previous/next walks the items of the person it was opened from", `sessionStorage.loads !== "2" || (sibs("prev") === "none" && sibs("next") === "#i/2" && count() === "1 / 2")`)}
${contract("after a reload the rail lists the trail's siblings and marks the open view", `sessionStorage.loads !== "2" || (sub(2) === "Person A|b" && sub(3) === "Four|Two" && document.querySelector('.toc [aria-current="page"]')?.textContent === "Four")`)}`;
	await run("trail", NESTED(script), [
		"--view",
		"none",
		"--do",
		"click:a[href='#p/a']",
		"--do",
		"click:a[href='#i/4']",
		"--do",
		"reload",
	]);
}, 60_000);

test("a view opened fresh walks every view of its kind in page order", async () => {
	const script = contract(
		"a fresh item has the overview as its only parent and all four items as siblings",
		`location.hash !== "#i/4" || (texts(".view.active .crumbs li") === "Home|Four" && sibs("prev") === "#i/3" && sibs("next") === "none" && count() === "4 / 4")`,
	);
	await run("fresh", NESTED(script), ["--view", "i/4"]);
}, 60_000);

test("a page with one kind of view has no rail", async () => {
	const page = `${HEAD}<main class="page"><div data-overview><h1>One view</h1><section><h2>Fixes</h2><a href="#f/a">A</a> <a href="#f/b">B</a></section></div>
<section class="view" data-view="f"><a class="back" href="#">All fixes</a><h1>Fix</h1></section></main>
<script src="kit:views.js"></script>
<script>${contract("no rail and no rail-side width", `!document.querySelector(".toc") && !document.documentElement.classList.contains("has-toc")`)}</script></body></html>`;
	await run("single", page, ["--view", "none"]);
}, 30_000);

test("a section with two folds gets Expand all, which follows the folds the reader toggles", async () => {
	const page = `${HEAD}<main class="page"><div data-overview><h1>Folds</h1>
<section id="two"><h2>Two</h2><div><details><summary>A</summary><p>a</p></details><details><summary>B</summary><p>b</p></details></div></section>
<section id="one"><h2>One</h2><details><summary>C</summary><p>c</p></details></section></div></main>
<script src="kit:views.js"></script>
<script>
const button = () => document.querySelector("#two > .fold-all");
const folds = () => [...document.querySelectorAll("#two details")];
${contract("one button before the block holding the first fold, none for a single fold", `button()?.nextElementSibling === folds()[0].parentElement && button().textContent === "Expand all" && !document.querySelector("#one .fold-all")`)}
const queue = [
	["Expand all opens every fold of its section", () => folds().every((d) => d.open) && button().textContent === "Collapse all" && button().getAttribute("aria-expanded") === "true"],
	["closing one fold by hand turns it back into Expand all", () => !folds()[0].open && button().textContent === "Expand all"],
];
document.addEventListener("click", () => {
	const [name, ok] = queue.shift() ?? [];
	setTimeout(() => { if (ok && !ok()) throw new Error("nav contract: " + name); }, 100);
});
</script></body></html>`;
	await run("folds", page, [
		"--view",
		"none",
		"--do",
		"click:#two > .fold-all",
		"--do",
		"click:#two summary",
	]);
}, 30_000);
