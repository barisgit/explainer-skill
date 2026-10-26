/* The Records component as a reader meets it, on the fixture page over the fictional RC-2 plan (test/fixtures/records/): what
   pack prerenders, the state the island keeps in the URL hash, the item views a row opens, print, and pack's config errors. */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, inPage, load, packedMdx, packMdx, runPacked, SETTLED, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const FIXTURES = join(import.meta.dir, "fixtures");

/** The fixture page, its imports made absolute so it packs from the scratch directory, with `tail` after it. */
const fixturePage = (tail = "") =>
	readFileSync(join(FIXTURES, "records", "page.mdx"), "utf8")
		.replace("../t6-plan.json", join(FIXTURES, "t6-plan.json"))
		.replace("./item.tsx", join(FIXTURES, "records", "item.tsx")) + tail;

test("pack prerenders the default tree with its controls hidden, and a block with nothing to choose as static markup", async () => {
	const html = readFileSync(await packedMdx(dir, "static", fixturePage()), "utf8");
	const plan = /<div[^>]*id="plan"[\s\S]*?<\/div>\s*<\/section>/.exec(html)?.[0] ?? "";
	expect(plan).toContain('class="records wide"');
	expect(plan).toMatch(/<div class="toolbar" hidden/);
	expect(plan).toMatch(/<div class="facets" hidden/);
	// The three phases as folds, every work item as a link to its view, and the total under the tree.
	expect(plan.match(/<details id="plan\.\d+"/g)).toHaveLength(3);
	expect(plan.match(/<a href="#item\/WP/g)).toHaveLength(96);
	expect(plan).toMatch(/class="tree-row total"[\s\S]*3,116/);
	// Every coloured marker sits beside its own word (a phase's title, a facet's value), so no legend repeats them.
	expect(plan).toMatch(/<i class="swatch" style="--swatch: var\(--c1\)"><\/i>Phase 1/);
	expect(plan.includes('class="legend"')).toBe(false);
	const owners = /<div class="records wide" id="owners"[^>]*>/.exec(html)?.[0] ?? "";
	expect(owners).not.toContain("data-records");
	expect(html).toMatch(/<summary data-ref="JV">[\s\S]*?<\/summary><p>/);
});

test("search, facets, views and sort go in the hash; links apply a state; an item view returns to it; Expand all and print open the tree", async () => {
	const contract = `${SETTLED}
const $ = (selector) => document.querySelector(selector);
const block = () => $("#plan");
const frames = () => new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50))).then(() => new Promise(requestAnimationFrame));
const navigated = (go) => new Promise((shown) => { addEventListener("hashchange", shown, { once: true }); go(); }).then(frames);
const shown = () => block().querySelector("output").textContent;
var contract = settled.then(frames).then(async () => {
	const failures = [];
	const expect = (ok, name) => ok || failures.push(name + " (hash " + location.hash + ", shown " + shown() + ")");
	expect(!block().querySelector(".toolbar").hidden, "the controls show once the island runs");
	const search = block().querySelector("input[type=search]");
	search.value = "board";
	search.dispatchEvent(new Event("input", { bubbles: true }));
	await frames();
	expect(location.hash === "#plan?q=board" && shown() === "8 of 96", "a search narrows the records and goes in the hash");
	block().querySelector(".reset").click();
	await frames();
	expect(location.hash === "" && shown() === "96 of 96", "Clear drops the hash");
	[...block().querySelectorAll(".facets button")].find((b) => b.textContent.startsWith("Jonas Vireo")).click();
	await frames();
	expect(location.hash === "#plan?f.owner=JV" && shown() === "19 of 96", "a facet filters and goes in the hash");
	expect(block().querySelectorAll(".tree a:not(.miss)").length === 19, "the tree marks the other rows");
	block().querySelector(".seg label:nth-child(2) input").click();
	await frames();
	expect(location.hash === "#plan?view=table&f.owner=JV" && block().querySelectorAll("tbody tr").length === 19, "the table shows the filtered rows");
	block().querySelector("th:last-child button.sort").click();
	await frames();
	expect(/sort=/.test(location.hash) && $("#plan th:last-child").getAttribute("aria-sort"), "a header sorts, in the hash");
	block().querySelector(".reset").click();
	await frames();
	block().querySelector(".seg label:nth-child(1) input").click();
	await frames();
	await navigated(() => $("a[href='#plan?f.owner=JV']").click());
	const pressed = [...block().querySelectorAll(".facets button[aria-pressed=true]")].map((b) => b.textContent);
	expect(pressed.length === 1 && pressed[0].startsWith("Jonas Vireo") && shown() === "19 of 96", "a link of the page's applies its state");
	const first = block().querySelector(".tree a:not(.miss)");
	await navigated(() => first.click());
	const view = $(".view.active");
	expect(view && view.querySelector("h1").textContent.startsWith(first.getAttribute("href").split("/")[1]), "a row opens its item view");
	expect(view && view.querySelector(".sibs [rel=next]"), "the item view has previous/next");
	await navigated(() => history.back());
	expect(location.hash === "#plan?f.owner=JV" && shown() === "19 of 96", "Back from the item returns to the filtered list");
	block().querySelector(".reset").click();
	await frames();
	block().querySelector(".fold-all").click();
	await frames();
	expect([...block().querySelectorAll(".tree details")].every((d) => d.open), "Expand all opens every group");
	block().querySelector(".fold-all").click();
	await frames();
	block().querySelector(".seg label:nth-child(3) input").click();
	await frames();
	dispatchEvent(new Event("beforeprint"));
	await frames();
	const groups = [...block().querySelectorAll(".tree details[id]")];
	expect(groups.length > 3 && groups.every((d) => d.open), "print shows the whole tree, every group open");
	dispatchEvent(new Event("afterprint"));
	await frames();
	expect(block().querySelector(".board"), "after print the reader's view is back");
	return failures;
});`;
	const output = await packedMdx(
		dir,
		"reader",
		fixturePage('\n<script src="contract.js"></script>\n'),
		{
			"contract.js": contract,
		},
	);
	expect(await runPacked(output)).toEqual([]);
}, 60_000);

let fixture: Promise<string> | undefined;
/** The fixture page packed once, for the tests that drive it in the browser. */
const packedFixture = () => {
	fixture ??= packedMdx(dir, "fixture", fixturePage());
	return fixture;
};

interface Folds {
	open: string;
	hash: string;
}
/** The plan block's open group ids, and the location hash, as Folds. */
const FOLDS = `({ open: [...document.querySelectorAll("#plan details[id]")].filter((d) => d.open).map((d) => d.id).join(" "), hash: location.hash })`;

test("opened groups go in the hash and come back after a reload, and a fold never replaces an anchor the reader came by", async () => {
	const seen = await inPage(await packedFixture(), async (cdp) => {
		const all = await act<Folds>(cdp, `document.querySelector("#plan .fold-all").click()`, FOLDS);
		await load(cdp);
		const allAfterReload = await cdp.evaluate<Folds>(FOLDS);
		await act(cdp, `document.querySelector("#plan .fold-all").click()`, FOLDS);
		const one = await act<Folds>(
			cdp,
			`document.getElementById("plan.2").querySelector("summary").click()`,
			FOLDS,
		);
		await load(cdp);
		const oneAfterReload = await cdp.evaluate<Folds>(FOLDS);
		// A link to a group's anchor opens its branch, and the hash stays the anchor.
		const anchor = await act<Folds>(cdp, `location.hash = "plan.3.wp10"`, FOLDS);
		await act(cdp, `location.hash = "plan?open=2"`, FOLDS);
		// Back to the page as it opened, with no hash: the default state.
		const cleared = await act<Folds>(cdp, `location.hash = ""`, FOLDS);
		return { all, allAfterReload, one, oneAfterReload, anchor, cleared };
	});
	// Three phases of five packages each.
	expect(seen.all.open.split(" ")).toHaveLength(3 + 3 * 5);
	expect(seen).toEqual({
		all: { open: seen.all.open, hash: "#plan?open=*" },
		allAfterReload: { open: seen.all.open, hash: "#plan?open=*" },
		one: { open: "plan.2", hash: "#plan?open=2" },
		oneAfterReload: { open: "plan.2", hash: "#plan?open=2" },
		anchor: { open: "plan.2 plan.3 plan.3.wp10", hash: "#plan.3.wp10" },
		cleared: { open: "", hash: "" },
	});
}, 30_000);

test("an incomplete sum shows as a lower bound or unknown in every view, in words for screen readers", async () => {
	const gaps = `{ idField: "id", fields: { id: { label: "Id", kind: "text" }, team: { label: "Team", kind: "text" }, hours: { label: "Hours", kind: "number", sum: true } }, columns: ["id", "hours"], groupBy: ["team"], data: [{ id: "a", team: "mixed", hours: 8 }, { id: "b", team: "mixed", hours: null }, { id: "c", team: "none" }] }`;
	const output = await packedMdx(
		dir,
		"gaps",
		`import { Records } from "kit";

export const gaps = ${gaps};

# Gaps

<Records id="tree" {...gaps} views={["tree"]} />

<Records id="table" {...gaps} views={["table"]} />

<Records id="board" {...gaps} views={["board"]} />
`,
	);
	const html = readFileSync(output, "utf8");
	const marked = (words: string) =>
		new RegExp(
			`<span class="incomplete"><span aria-hidden="true" title="${words}">([^<]*)</span><span class="vh">${words}</span></span>`,
			"g",
		);
	const shown = (id: string, words: string) => {
		const block = (html.split(`id="${id}"`)[1] ?? "").split('class="records wide"')[0] ?? "";
		return [...block.matchAll(marked(words))].map((m) => m[1]);
	};
	// The mixed group or lane, the one with no value, and the total of the tree and the table (the table shows no groups).
	const seen = ["tree", "table", "board"].map((id) => [
		id,
		shown(id, "at least 8, 1 without a value"),
		shown(id, "unknown, 1 without a value"),
		shown(id, "at least 8, 2 without a value"),
	]);
	expect(seen).toEqual([
		["tree", ["≥ 8"], ["?"], ["≥ 8"]],
		["table", [], [], ["≥ 8"]],
		["board", ["≥ 8"], ["?"], []],
	]);
});

test("a board names each value on its cards and lane heads, out of sight where the value names itself", async () => {
	const output = await packedMdx(
		dir,
		"board",
		`import { Records } from "kit";

# Board

<Records id="work" idField="id" fields={{ id: { label: "Item", kind: "text" }, team: { label: "Team", kind: "text" }, owner: { label: "Owner", kind: "text" }, hours: { label: "Hours", kind: "number", unit: "h", sum: true }, due: { label: "Due", kind: "date" } }} columns={["id", "hours", "owner", "due"]} groupBy={["team"]} views={["board"]} data={[{ id: "A-1", team: "core", owner: "HO", hours: 8, due: "2027-03-01" }, { id: "A-2", team: "core", owner: "JV", hours: 4 }]} />
`,
	);
	const html = readFileSync(output, "utf8").replace(/\u00a0/g, " ");
	const card = /<li><p>A-1<\/p>(<dl>[\s\S]*?<\/dl>)<\/li>/.exec(html)?.[1];
	expect(card).toBe(
		'<dl><div><dt>Hours</dt><dd>8 h</dd></div><div><dt class="vh">Owner</dt><dd>HO</dd></div><div><dt>Due</dt><dd>Mar 1, 2027</dd></div></dl>',
	);
	// A card leaves out a value it does not have.
	expect(/<li><p>A-2<\/p><dl>([\s\S]*?)<\/dl>/.exec(html)?.[1]).not.toContain("Due");
	const head = /<div class="lane-head">([\s\S]*?)<\/div><ul>/.exec(html)?.[1];
	expect(head).toBe(
		"<p>core</p><dl><div><dt>Records</dt><dd>2</dd></div><div><dt>Hours</dt><dd>12 h</dd></div></dl>",
	);
});

test("a record's detail opens in place in every view, stays open across them, and Expand all reaches it", async () => {
	const output = await packedMdx(
		dir,
		"details",
		`import { Records } from "kit";

# Details

<Records id="why" idField="id" fields={{ id: { label: "Item", kind: "text" }, team: { label: "Team", kind: "text" }, hours: { label: "Hours", kind: "number" }, basis: { label: "Basis", kind: "text" } }} columns={["id", "hours"]} groupBy={["team"]} views={["tree", "table", "board"]} detail="basis" data={[{ id: "A-1", team: "core", hours: 8, basis: "Measured on A." }, { id: "A-2", team: "core", hours: 4, basis: "Guessed." }, { id: "B-1", team: "edge", hours: 2 }]} />
`,
	);
	const block = `document.getElementById("why")`;
	const seen = `(() => {
			const b = ${block};
			const button = b.querySelector(".fold-all");
			return {
				details: [...b.querySelectorAll("details:not([id])")].map((d) => d.querySelector("summary").textContent.trim().slice(0, 3) + (d.open ? " open: " + d.querySelector("p").textContent : "")),
				button: button && button.textContent + " " + button.getAttribute("aria-expanded"),
				hash: location.hash,
			};
		})()`;
	const view = (n: number) => `${block}.querySelector(".seg label:nth-child(${n}) input").click()`;
	const states = await inPage(output, async (cdp) => {
		const expanded = await act(cdp, `${block}.querySelector(".fold-all").click()`, seen);
		const oneClosed = await act(
			cdp,
			`${block}.querySelector("details:not([id]) summary").click()`,
			seen,
		);
		const table = await act(cdp, view(2), seen);
		const opened = await act(cdp, `${block}.querySelector("tbody th summary").click()`, seen);
		const board = await act(cdp, view(3), seen);
		return { expanded, oneClosed, table, opened, board };
	});
	expect(states).toEqual({
		expanded: {
			details: ["A-1 open: Measured on A.", "A-2 open: Guessed."],
			button: "Collapse all true",
			hash: "#why?open=*&detail=*",
		},
		// One detail closed again: the tree is no longer all open, though every group is.
		oneClosed: {
			details: ["A-1", "A-2 open: Guessed."],
			button: "Expand all false",
			hash: "#why?open=*&detail=A-2",
		},
		table: {
			details: ["A-1", "A-2 open: Guessed."],
			button: null,
			hash: "#why?view=table&open=*&detail=A-2",
		},
		opened: {
			details: ["A-1 open: Measured on A.", "A-2 open: Guessed."],
			button: null,
			hash: "#why?view=table&open=*&detail=*",
		},
		board: {
			details: ["A-1 open: Measured on A.", "A-2 open: Guessed."],
			button: null,
			hash: "#why?view=board&open=*&detail=*",
		},
	});
}, 30_000);

test("pack fails on a bad config, naming the path of each problem", async () => {
	const { result } = await packMdx(
		dir,
		"bad",
		`import { Records } from "kit";

# Plan

<Records id="plan" data={[{ id: "a", hours: 2 }]} idField="id" fields={{ id: { label: "Id", kind: "text" }, hours: { label: "Hours", kind: "hour" } }} columns={["id", "hours", "owner"]} />
`,
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain('records "plan"');
	expect(result.stderr).toContain("fields.hours.kind");
	expect(result.stderr).toContain("columns[2]");
});
