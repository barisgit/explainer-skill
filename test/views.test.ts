import { afterAll, expect, test } from "bun:test";
import { packAndCheck, packAndRun, SETTLED, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Views</h1>
<div data-overview>overview</div>
<section class="view" data-view="v"><h2>View</h2></section></main>
<script src="kit:views.js"></script>
<script>
let param;
Views.on("v", (_, p) => { param = p; });
document.addEventListener("DOMContentLoaded", () => { location.hash = "#v/100%"; });
// Added after the router's own listener, so the view is shown when it runs.
var contract = new Promise((shown) => addEventListener("hashchange", shown, { once: true })).then(() =>
	param === "100%" && document.documentElement.classList.contains("in-view") ? [] : ["a hash with a malformed escape still opens its view, with the param as written"]);
</script></body></html>`;

test("a hash with a malformed percent escape does not break the router", async () => {
	expect(await packAndRun(dir, "views", PAGE)).toEqual([]);
}, 30_000);

const ANCHOR_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<div data-overview><h1>Views</h1><div style="block-size: 3000px"></div><section id="far"><h2>Far</h2></section><div style="block-size: 3000px"></div></div>
<section class="view" data-view="v"><h2>View</h2><a id="to-far" href="#far">Far section</a></section></main>
<script src="kit:views.js"></script>
<script>
// The overview is hidden when the hash changes, so the browser cannot scroll to #far then; Chrome keeps the fragment scroll pending
// until the section has a box. The router restores the overview's old position on the same change and must not undo that.
${SETTLED}
const navigated = (go) => new Promise((shown) => { addEventListener("hashchange", shown, { once: true }); go(); });
const frame = () => new Promise(requestAnimationFrame);
var contract = settled.then(async () => {
	await navigated(() => { location.hash = "#v/a"; });
	await navigated(() => document.getElementById("to-far").click());
	// The pending fragment scroll runs with the layout that gives the section its box.
	await frame();
	await frame();
	const far = document.getElementById("far").getBoundingClientRect().top;
	return document.documentElement.classList.contains("in-view") || Math.abs(far) > 2 ? ["a link from a view to a section's #id lands on that section (top " + far + ")"] : [];
});
</script></body></html>`;

test("a link from a view to an overview section's #id scrolls to that section", async () => {
	expect(await packAndRun(dir, "anchor", ANCHOR_PAGE)).toEqual([]);
}, 30_000);

/** Static views whose param has a non-ASCII letter or a space, which location.hash reports percent-encoded. */
const STATIC_RAW_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<div data-overview><h1>Kdo</h1><a href="#kdo/blaž">Blaž</a> <a href="#kdo/ana marija">Ana Marija</a></div>
<section class="view" data-view="kdo/blaž"><a class="back" href="#">Vsi</a><h2>Blaž</h2><a href="#kdo/ana marija">Ana Marija</a></section>
<section class="view" data-view="kdo/ana marija"><a class="back" href="#">Vsi</a><h2>Ana Marija</h2></section></main>
<script src="kit:views.js"></script>
<script>
const shown = () => {
	const want = decodeURIComponent(location.hash.slice(1));
	return !want || document.querySelector(".view.active")?.dataset.view === want;
};
const expectShown = (how) => setTimeout(() => {
	if (!shown()) throw new Error("views contract: a static view with a raw param opens " + how + ": " + location.hash);
}, 100);
expectShown("by deep link");
addEventListener("hashchange", () => expectShown("by link"));
</script></body></html>`;

test("a static view whose param has a non-ASCII letter or a space opens by link and by deep link", async () => {
	await packAndCheck(dir, "static-raw", STATIC_RAW_PAGE, "views contract", [
		"--view",
		"kdo/blaž",
		"--view",
		"kdo/ana marija",
		"--do",
		"click:a[href='#kdo/blaž']",
		"--do",
		"click:.view.active a[href='#kdo/ana marija']",
	]);
}, 30_000);
