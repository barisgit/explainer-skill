import { afterAll, expect, test } from "bun:test";
import { packAndCheck, packAndRun, pageAssertion, pageContract, scratch } from "./support.ts";

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
// The navigation type, not a load count: check opens the page fresh at each width, and the reload contracts run at both.
const reloaded = () => performance.getEntriesByType("navigation")[0]?.type === "reload";
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent).join("|");
const view = () => document.querySelector(".view.active");
const sibs = (rel) => view().querySelector(".sibs [rel=" + rel + "]")?.getAttribute("href") ?? "none";
const count = () => view().querySelector(".sibs .count")?.textContent;
const sub = (n) => texts(".toc #toc-list > li:nth-child(" + n + ") ol a");
${script}
</script></body></html>`;

const contract = (name: string, body: string) => pageAssertion("nav contract", name, body);

test("the trail and previous/next follow the view the reader came from, and survive a reload", async () => {
	const script = `
${contract("a page with views inside views has a rail of its sections", `location.hash || (document.documentElement.classList.contains("has-toc") && texts("#toc-list > li > a") === "Home|People|Items")`)}
${contract("after a reload the trail names each step, a generic link text giving way to the view's heading", `!reloaded() || texts(".view.active .crumbs li") === "Home|Person A|Four"`)}
${contract("the view's own .back link stays, as the first crumb", `!location.hash || (view().querySelectorAll(".back").length === 1 && view().querySelector(".crumbs li:first-child > .back"))`)}
${contract("after a reload previous/next walks the items of the person it was opened from", `!reloaded() || (sibs("prev") === "none" && sibs("next") === "#i/2" && count() === "1 / 2")`)}
${contract("after a reload the rail lists the trail's siblings and marks the open view", `!reloaded() || (sub(2) === "Person A|b" && sub(3) === "Four|Two" && document.querySelector('.toc [aria-current="page"]')?.textContent === "Four")`)}`;
	await packAndCheck(dir, "trail", NESTED(script), "nav contract", [
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
	await packAndCheck(dir, "fresh", NESTED(script), "nav contract", ["--view", "i/4"]);
}, 60_000);

/** Hashes written raw, with non-ASCII letters and spaces, which location.hash reports percent-encoded. Blaž links two items. */
const RAW_HASHES = `${HEAD}<main class="page"><div data-overview><h1>Names</h1>
<section><h2>People</h2><a href="#person/Blaž">Blaž</a> <a href="#person/Ana Marija">Ana Marija</a></section>
<section><h2>Items</h2><a href="#item/my item">My item</a> <a href="#item/Čaj">Čaj</a> <a href="#item/third one">Third</a></section></div>
<section class="view" data-view="person"><div class="view-head"><a class="back" href="#">Home</a><h1></h1></div><p class="mine"></p></section>
<section class="view" data-view="item"><div class="view-head"><a class="back" href="#">Home</a><h1></h1></div></section></main>
<script src="kit:views.js"></script>
<script>
Views.on("person", (el, p) => {
	el.querySelector("h1").textContent = p;
	el.querySelector(".mine").innerHTML = p === "Blaž" ? '<a href="#item/Čaj">Čaj</a> <a href="#item/my item">My item</a>' : "";
});
Views.on("item", (el, p) => { el.querySelector("h1").textContent = p; });
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent).join("|");
const sibs = (rel) => decodeURIComponent(document.querySelector(".view.active .sibs [rel=" + rel + "]")?.getAttribute("href") ?? "none");
const count = () => document.querySelector(".view.active .sibs .count")?.textContent;
const railCurrent = () => document.querySelector('.toc [aria-current="page"]')?.textContent;
const at = () => decodeURIComponent(location.hash);
const journey = () => texts(".view.active .crumbs li") === "Home|Blaž|My item" && count() === "2 / 2" && sibs("prev") === "#item/Čaj" && sibs("next") === "none" && railCurrent() === "My item";
const reloaded = () => performance.getEntriesByType("navigation")[0]?.type === "reload";
// Load-time contracts: a load on a hash that is not a reload is a view check opened fresh.
const fresh = () => !reloaded() && location.hash !== "";
${contract("a person opened fresh by a raw Unicode hash walks every person", `!fresh() || at() !== "#person/Blaž" || (texts(".view.active .crumbs li") === "Home|Blaž" && count() === "1 / 2" && sibs("next") === "#person/Ana Marija" && railCurrent() === "Blaž")`)}
${contract("an item opened fresh by a hash with a space walks every item", `!fresh() || at() !== "#item/my item" || (texts(".view.active .crumbs li") === "Home|My item" && count() === "1 / 3" && sibs("next") === "#item/Čaj" && railCurrent() === "My item")`)}
${contract("after a reload the item opened from Blaž walks Blaž's items", "!reloaded() || journey()")}
addEventListener("hashchange", () => setTimeout(() => {
	if (at() === "#item/my item" && !journey()) throw new Error("nav contract: the item opened from Blaž walks Blaž's items");
}, 100));
</script></body></html>`;

test("hashes with Unicode letters and spaces keep previous/next and the rail, fresh, through a person and after a reload", async () => {
	await packAndCheck(dir, "raw", RAW_HASHES, "nav contract", [
		"--view",
		"person/Blaž",
		"--view",
		"item/my item",
		"--do",
		"click:a[href='#person/Blaž']",
		"--do",
		"click:.view.active a[href='#item/my item']",
		"--do",
		"reload",
	]);
}, 60_000);

/** Every link text is generic, so labels come from headings; the item handler is registered after startup and draws two folds. */
const LATE = `${HEAD}<main class="page"><div data-overview><h1>Late</h1>
<section><h2>People</h2><a href="#p/a">Open</a> <a href="#p/b">Open</a></section>
<section><h2>Items</h2><a href="#i/1">Open</a> <a href="#i/2">Open</a> <a href="#i/3">Open</a></section></div>
<section class="view" data-view="p"><div class="view-head"><a class="back" href="#">Home</a><h1></h1></div><p class="mine"></p></section>
<section class="view" data-view="i"><div class="view-head"><a class="back" href="#">Home</a><h1></h1></div><div class="folds"></div></section></main>
<script src="kit:views.js"></script>
<script>
Views.on("p", (el, p) => {
	el.querySelector("h1").textContent = "Person " + p.toUpperCase();
	el.querySelector(".mine").innerHTML = p === "a" ? '<a href="#i/3">Open</a> <a href="#i/1">Open</a>' : "";
});
addEventListener("DOMContentLoaded", () => setTimeout(() => Views.on("i", (el, p) => {
	el.querySelector("h1").textContent = "Item " + p;
	el.querySelector(".folds").innerHTML = "<details><summary>A</summary>a</details><details><summary>B</summary>b</details>";
}), 50));
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent).join("|");
const expandAll = () => document.querySelector(".view.active > .fold-all")?.textContent === "Expand all";
const reloaded = () => performance.getEntriesByType("navigation")[0]?.type === "reload";
${contract("a view whose handler registers late is named by the heading it draws and gets Expand all", `reloaded() || location.hash !== "#i/3" || (texts(".view.active .crumbs li") === "Home|Item 3" && expandAll())`)}
${contract("after a reload with a late handler the item keeps the person's items and gets Expand all", `!reloaded() || (texts(".view.active .crumbs li") === "Home|Person A|Item 3" && document.querySelector(".view.active .sibs .count")?.textContent === "1 / 2" && expandAll())`)}
</script></body></html>`;

test("a handler registered after startup gets the navigation and Expand all, without losing the trail", async () => {
	await packAndCheck(dir, "late", LATE, "nav contract", [
		"--view",
		"i/3",
		"--do",
		"click:a[href='#p/a']",
		"--do",
		"click:.view.active a[href='#i/3']",
		"--do",
		"reload",
	]);
}, 60_000);

/** A page that writes its own history.state on every entry it shows, before the kit's navigation runs for that entry. */
const OWN_STATE = (value: string) => `${HEAD}<main class="page"><div data-overview><h1>State</h1>
<section><h2>Views</h2><a href="#v/a">A</a> <a href="#v/b">B</a></section></div>
<section class="view" data-view="v"><a class="back" href="#">Home</a><h1>V</h1><a id="next" href="#v/b">B</a></section></main>
<script src="kit:views.js"></script>
<script>
const value = ${value};
const write = () => { if (history.state === null) history.replaceState(value, ""); };
write();
Views.on("v", write);
const kept = () => typeof history.state === typeof value && Array.isArray(history.state) === Array.isArray(value) && JSON.stringify(history.state) === JSON.stringify(value);
const expectKept = (when) => setTimeout(() => {
	if (!kept()) throw new Error("nav contract: the page's own state survives " + when + ", read back as " + JSON.stringify(history.state));
}, 300);
expectKept(performance.getEntriesByType("navigation")[0]?.type === "reload" ? "a reload" : "startup");
addEventListener("hashchange", () => expectKept("navigation"));
</script></body></html>`;

for (const [kind, value] of [
	["a number", "7"],
	["a string", '"page-token"'],
	["an array", '["a", 2]'],
	["an object", '{ "filter": "coal" }'],
] as const) {
	test(`a page's own history.state, ${kind}, reads back as written through startup, navigation and reload`, async () => {
		await packAndCheck(dir, `state-${kind.split(" ")[1]}`, OWN_STATE(value), "nav contract", [
			"--view",
			"none",
			"--do",
			"click:a[href='#v/a']",
			"--do",
			"click:#next",
			"--do",
			"reload",
		]);
	}, 30_000);
}

test("a section id the rail adds is unique among the page's ids and view names", async () => {
	// Neither heading gives a usable slug ("→" has none, "b" is a view name), and section-1 and section-2 are taken.
	const page = `${HEAD}<main class="page"><div data-overview><h1>Ids</h1><p id="section-1">taken</p>
<section><h2>→</h2><a href="#a/1">A</a></section><section><h2>b</h2><a href="#b/1">B</a></section></div>
<section class="view" data-view="a"><h1>A</h1></section><section class="view" data-view="b"><h1>B</h1></section>
<section class="view" data-view="section-2"><h1>S</h1></section></main>
<script src="kit:views.js"></script>
<script>
const names = [...document.querySelectorAll("[data-view]")].map((v) => v.dataset.view);
const unique = (s) => s.id && !names.includes(s.id) && document.querySelectorAll("#" + CSS.escape(s.id)).length === 1;
${pageContract({ "every overview section has an id of its own": `[...document.querySelectorAll("[data-overview] > section")].every(unique)` })}
</script></body></html>`;
	expect(await packAndRun(dir, "ids", page)).toEqual([]);
}, 30_000);

test("a page with one kind of view has no rail", async () => {
	const page = `${HEAD}<main class="page"><div data-overview><h1>One view</h1><section><h2>Fixes</h2><a href="#f/a">A</a> <a href="#f/b">B</a></section></div>
<section class="view" data-view="f"><a class="back" href="#">All fixes</a><h1>Fix</h1></section></main>
<script src="kit:views.js"></script>
<script>${pageContract({ "no rail and no rail-side width": `!document.querySelector(".toc") && !document.documentElement.classList.contains("has-toc")` })}</script></body></html>`;
	expect(await packAndRun(dir, "single", page)).toEqual([]);
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
	await packAndCheck(dir, "folds", page, "nav contract", [
		"--view",
		"none",
		"--do",
		"click:#two > .fold-all",
		"--do",
		"click:#two summary",
	]);
}, 30_000);
