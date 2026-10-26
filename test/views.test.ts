import { afterAll, expect, test } from "bun:test";
import {
	act,
	inPage,
	load,
	packAndCheck,
	packAndRun,
	packedMdx,
	SETTLED,
	scratch,
} from "./support.ts";

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
	if (document.documentElement.classList.contains("in-view") || Math.abs(far) > 2) return ["a link from a view to a section's #id lands on that section (top " + far + ")"];
	// Back on the overview entry at #far returns to where the reader left it, not to #far.
	scrollTo(0, scrollY + 500);
	const left = scrollY;
	await navigated(() => { location.hash = "#v/b"; });
	await navigated(() => history.back());
	await frame();
	return Math.abs(scrollY - left) > 2 ? ["Back to the overview at an #id returns to where the reader left it (" + scrollY + ", left at " + left + ")"] : [];
});
</script></body></html>`;

test("a link from a view to an overview section's #id scrolls to that section", async () => {
	expect(await packAndRun(dir, "anchor", ANCHOR_PAGE)).toEqual([]);
}, 30_000);

/** A view whose handler draws a link to a paragraph further down the same view, and an overview link back. */
const IN_VIEW_ANCHOR_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<div data-overview><h1>Views</h1><a href="#v/a">A</a> <a href="#v/b">B</a></div>
<section class="view" data-view="v"><a class="back" href="#">Home</a><h2>View</h2><div class="body"></div></section>
<section class="view" data-view="w" id="w"><a class="back" href="#">Home</a><h2>W</h2></section></main>
<script src="kit:views.js"></script>
<script>
let drawnFor = "";
Views.on("v", (el, p) => {
	drawnFor = p;
	el.querySelector(".body").innerHTML = '<a id="to-detail" href="#detail">Detail</a><div style="block-size: 3000px"></div><p id="detail">Detail of ' + p + '</p><div style="block-size: 3000px"></div>';
});
${SETTLED}
const navigated = (go) => new Promise((shown) => { addEventListener("hashchange", shown, { once: true }); go(); });
const frame = () => new Promise(requestAnimationFrame);
const inView = () => document.documentElement.classList.contains("in-view") && document.querySelector(".view.active")?.dataset.view === "v";
const atDetail = () => Math.abs(document.getElementById("detail")?.getBoundingClientRect().top ?? 1e9) <= 2;
var contract = settled.then(async () => {
	const failures = [];
	await navigated(() => { location.hash = "#v/a"; });
	await navigated(() => document.getElementById("to-detail").click());
	await frame();
	if (!(inView() && atDetail() && drawnFor === "a")) failures.push("a link to an #id inside the open view stays in that view, at the target (top " + document.getElementById("detail")?.getBoundingClientRect().top + ")");
	if (document.querySelector(".view.active .crumbs [aria-current]")?.textContent !== "A") failures.push("the view keeps its trail after an in-view anchor");
	await navigated(() => document.querySelector("[data-view=v] .back").click());
	await navigated(() => history.back());
	await frame();
	if (!(inView() && drawnFor === "a" && document.getElementById("detail"))) failures.push("Back to an in-view anchor shows its view again");
	// Another param draws the same #detail; Back to the entry left from A shows A's again.
	await navigated(() => { location.hash = "#v/b"; });
	await navigated(() => history.back());
	if (!(drawnFor === "a" && document.getElementById("detail").textContent === "Detail of a")) failures.push("Back to an anchor that every param draws shows the param it was followed in");
	if (history.state !== null) failures.push("history.state stays the page's");
	// A view hash that is also its section's id is a route, not an anchor: the view's heading takes focus.
	await navigated(() => { location.hash = "#w"; });
	if (document.activeElement?.textContent !== "W") failures.push("a static view whose id is its hash focuses its heading");
	return failures;
});
</script></body></html>`;

test("a link to an #id inside a view stays in that view, and Back returns to it", async () => {
	expect(await packAndRun(dir, "in-view-anchor", IN_VIEW_ANCHOR_PAGE)).toEqual([]);
}, 30_000);

/** The anchor sits in a closed fold that a handler registered after startup draws, so a reload finds the view before the anchor. */
const LATE_ANCHOR_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<div data-overview><h1>Views</h1><a href="#v/a">A</a></div>
<section class="view" data-view="v"><a class="back" href="#">Home</a><h2>View</h2><div class="body"></div></section></main>
<script src="kit:views.js"></script>
<script>
addEventListener("DOMContentLoaded", () => setTimeout(() => {
	Views.on("v", (el, p) => {
		el.querySelector(".body").innerHTML = '<a id="to-detail" href="#detail">Detail</a><div style="block-size: 3000px"></div><details><summary>More</summary><p id="detail">Detail of ' + p + '</p></details><div style="block-size: 3000px"></div>';
	});
	const detail = document.getElementById("detail");
	if (location.hash === "#detail" && !(detail?.closest("details").open && Math.abs(detail.getBoundingClientRect().top) <= 2)) {
		throw new Error("views contract: a reload onto an in-view anchor that a late handler draws opens its fold and scrolls to it");
	}
}, 50));
</script></body></html>`;

test("a reload onto an in-view anchor drawn by a late handler lands on it", async () => {
	await packAndCheck(dir, "late-anchor", LATE_ANCHOR_PAGE, "views contract", [
		"--do",
		"click:a[href='#v/a']",
		"--do",
		"click:#to-detail",
		"--do",
		"reload",
	]);
}, 60_000);

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

/** Page expression: the open view's param heading, the hash, its crumbs and its previous, position and next. */
const SHOWN = `(() => {
	const view = document.querySelector(".view.active");
	const sibs = view?.querySelector(".sibs");
	return {
		h1: view?.querySelector("h1")?.textContent ?? null,
		hash: location.hash,
		crumbs: [...(view?.querySelectorAll(".crumbs li") ?? [])].map((li) => li.textContent).join(" / "),
		prev: sibs?.querySelector("[rel=prev]")?.getAttribute("href") ?? null,
		count: sibs?.querySelector(".count")?.textContent ?? null,
		next: sibs?.querySelector("[rel=next]")?.getAttribute("href") ?? null,
	};
})()`;

/** Static views linked with local state after their route, the form a Records block inside a view writes. */
const LOCAL_STATE_PAGE = `import { View } from "kit";

# Units

Three units.

## Units

- [Alpha](#v/a?panel?x=1)
- [Beta](#v/b?panel?x=2)
- [Gamma](#v/c)

{["a", "b", "c"].map((p) => <View name="v" param={p} back="Units"><h1>{p.toUpperCase()}</h1><p>Unit {p}.</p></View>)}
`;

test("links with local state after the route walk their views by the route, and previous and next keep each link's state", async () => {
	const output = await packedMdx(dir, "local-state", LOCAL_STATE_PAGE);
	const seen = await inPage(output, async (cdp) => {
		const first = await act(
			cdp,
			`document.querySelector("a[href='#v/a?panel?x=1']").click()`,
			SHOWN,
		);
		const next = await act(cdp, `document.querySelector(".view.active [rel=next]").click()`, SHOWN);
		await load(cdp);
		const reloaded = await cdp.evaluate(SHOWN);
		return { first, next, reloaded };
	});
	const beta = {
		h1: "B",
		hash: "#v/b?panel?x=2",
		crumbs: "Units / Beta",
		prev: "#v/a?panel?x=1",
		count: "2 / 3",
		next: "#v/c",
	};
	expect(seen).toEqual({
		first: {
			h1: "A",
			hash: "#v/a?panel?x=1",
			crumbs: "Units / Alpha",
			prev: null,
			count: "1 / 3",
			next: "#v/b?panel?x=2",
		},
		next: beta,
		reloaded: beta,
	});
}, 30_000);

/** Static views whose record ids hold characters a route cannot carry as they are, linked as encodeURIComponent writes them. */
const ESCAPED_PAGE = `import { View } from "kit";

# Odd ids

Two records.

## Records

- [Why?](#s/a%3Fb)
- [Most](#s/100%25)

{["a?b", "100%"].map((id) => <View name="s" param={id} back="Records"><h1>{id}</h1><p>Record {id}.</p></View>)}
`;

test("a static view whose record id holds ? or % opens at its escaped link, by click, deep link and previous/next", async () => {
	const output = await packedMdx(dir, "escaped", ESCAPED_PAGE);
	const seen = await inPage(`${output}#s/a%3Fb`, async (cdp) => {
		const deep = await cdp.evaluate(SHOWN);
		const next = await act(cdp, `document.querySelector(".view.active [rel=next]").click()`, SHOWN);
		await act(cdp, `location.hash = ""`, SHOWN);
		const clicked = await act(cdp, `document.querySelector("a[href='#s/a%3Fb']").click()`, SHOWN);
		return { deep, next, clicked };
	});
	const why = {
		h1: "a?b",
		hash: "#s/a%3Fb",
		crumbs: "Records / Why?",
		prev: null,
		count: "1 / 2",
		next: "#s/100%25",
	};
	expect(seen).toEqual({
		deep: why,
		next: {
			h1: "100%",
			hash: "#s/100%25",
			crumbs: "Records / Most",
			prev: "#s/a%3Fb",
			count: "2 / 2",
			next: null,
		},
		clicked: why,
	});
}, 30_000);
