import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Cdp, withPage } from "../skills/explainer/src/chrome.ts";
import { load, packedMdx, packMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A hundred work items, as a page imports them from a data file. */
const ITEMS = Array.from({ length: 100 }, (_, i) => ({
	id: `t${i + 1}`,
	name: `${Math.floor(i / 10) + 1}.${(i % 10) + 1} Task ${i + 1}`,
	hours: 4 + ((i * 7) % 30),
	owner: ["Ana", "Luka", "Mia"][i % 3],
	why: `Task ${i + 1} is in because the release needs it.`,
}));

/** The view of one item; `{ record }` stands for the item in both pages. */
const ITEM_BODY = `<h1>{record.name}</h1>
<p>{record.hours} h, owned by {record.owner}.</p>
<section>
<h2>Why it is in</h2>
<p>{record.why}</p>
<textarea id={\`note-\${record.id}\`} aria-label="Note" />
</section>`;

/** The client component a filled view renders the item with. */
const ITEM_TSX = `"use client";
interface Item { id: string; name: string; hours: number; owner: string; why: string }

export function Item({ record }: { record: Item }) {
	return (<>
${ITEM_BODY}
	</>);
}
`;

/** A client component that cannot draw one record. */
const BOOM = `"use client";
export function Boom({ record }: { record: { id: string } }) {
	if (record.id === "bad") throw new Error("no such task");
	return <h1>{record.id}</h1>;
}
`;

/** The page with `views` in place of its item views; it keeps inputs and links every view from the overview. */
const page = (views: string, imports = "") => `---
reply: true
---
import { View } from "kit";
import items from "./items.json";
${imports}

# Work list

A hundred tasks, three people.

## Tasks

<ul>{items.map((i) => <li><a href={\`#item/\${i.id}\`}>{i.name}</a></li>)}</ul>

## Method

See [how it was counted](#about).

${views}

<View name="about" back="Work list">

# How it was counted

From the work list.

## Sources

The work list.

</View>
`;

const FILLED = page(
	`<View name="item" records={items} render={Item} back="Work list" />`,
	'import { Item } from "./item.tsx";',
);
const STATIC = page(`{items.map((record) => (
<View name="item" param={record.id} back="Work list">
${ITEM_BODY}
</View>
))}`);

/** The items and the Item component the pages import, beside `files`. */
const besideItems = (files: Record<string, string> = {}) => ({
	"items.json": JSON.stringify(ITEMS),
	"item.tsx": ITEM_TSX,
	...files,
});

/** Packs `source` as `<name>.mdx` beside the items, Item and `files`; returns the CLI result and the output path. */
const pack = (name: string, source: string, files: Record<string, string> = {}) =>
	packMdx(dir, name, source, besideItems(files));

/** Packs `source` beside the items and Item, failing the test unless the pack succeeds without a message; returns the output path. */
const packed = (name: string, source: string) => packedMdx(dir, name, source, besideItems());

/** Runs `fn` in headless Chrome with `media` emulated; fails on any uncaught page error. */
function inChrome<T>(fn: (cdp: Cdp) => Promise<T>, media = "screen"): Promise<T> {
	return withPage(async (cdp) => {
		const errors: string[] = [];
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
			errors.push(d.exception?.description ?? d.text),
		);
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setEmulatedMedia", { media });
		const result = await fn(cdp);
		expect(errors).toEqual([]);
		return result;
	});
}

/** What a reader sees of the open view and the navigation, as text: what must not differ between a static and a filled view. */
const SHOWN = `(() => {
	const view = document.querySelector(".view.active");
	const copy = view.cloneNode(true);
	copy.removeAttribute("data-view");
	copy.removeAttribute("data-fill");
	return { view: copy.outerHTML, rail: document.querySelector(".toc").outerHTML, focused: document.activeElement.outerHTML };
})()`;

/** SHOWN for each hash, each opened fresh (a reload on the hash), then reached by its previous/next link. */
async function shownAt(output: string, hashes: string[]) {
	return inChrome(async (cdp) => {
		const seen: unknown[] = [];
		for (const hash of hashes) {
			await load(cdp, "about:blank");
			await load(cdp, `file://${output}${hash}`);
			seen.push(await cdp.evaluate(SHOWN));
			seen.push(
				await cdp.evaluate(
					`(document.querySelector(".view.active [rel=next]") ?? document.querySelector(".view.active [rel=prev]")).click(), ${SHOWN}`,
				),
			);
		}
		return seen;
	});
}

describe("a filled view in the browser", () => {
	test("draws the record at #name/param as a static view does: head, crumbs, previous/next, rail and focus", async () => {
		const [filled, still] = await Promise.all([packed("filled", FILLED), packed("static", STATIC)]);
		const html = readFileSync(filled, "utf8");
		expect(html).not.toContain("<h1>5.2 Task 42</h1>");
		expect(html).toContain('<section class="view" data-view="item" data-fill></section>');
		const hashes = ["#item/t42", "#item/t1", "#item/t100"];
		const [fromFilled, fromStatic] = await Promise.all([
			shownAt(filled, hashes),
			shownAt(still, hashes),
		]);
		expect(JSON.stringify(fromFilled)).toContain('<h1 tabindex=\\"-1\\">5.2 Task 42</h1>');
		expect(fromFilled).toEqual(fromStatic);
	}, 90_000);

	test("keeps a control's value while the reader moves between records and across a reload", async () => {
		const output = await packed("keep", FILLED);
		const value = (cdp: Cdp) =>
			cdp.evaluate<string | undefined>(`document.getElementById("note-t2")?.value`);
		const go = (cdp: Cdp, hash: string) =>
			cdp.evaluate(
				`new Promise((done) => { addEventListener("hashchange", () => setTimeout(done, 50), { once: true }); location.hash = "${hash}"; })`,
				true,
			);
		const seen = await inChrome(async (cdp) => {
			await load(cdp, `file://${output}#item/t2`);
			await cdp.evaluate(
				`(() => { const note = document.getElementById("note-t2"); note.value = "check the clocks"; note.dispatchEvent(new Event("input", { bubbles: true })); })()`,
			);
			await go(cdp, "#item/t3");
			const away = await cdp.evaluate<string>(`document.getElementById("note-t3").value`);
			await go(cdp, "#item/t2");
			const back = await value(cdp);
			await go(cdp, "#");
			await load(cdp);
			await go(cdp, "#item/t2");
			return { away, back, reloaded: await value(cdp) };
		});
		expect(seen).toEqual({ away: "", back: "check the clocks", reloaded: "check the clocks" });
	}, 60_000);

	test("prints only while it is open; the overview and the static views always print", async () => {
		const output = await packed("print", FILLED);
		const shown = `[...document.querySelectorAll("[data-overview], .view")].filter((el) => getComputedStyle(el).display !== "none").map((el) => el.dataset.view ?? "overview").join(" ")`;
		const printed = await inChrome(async (cdp) => {
			await load(cdp, `file://${output}`);
			const overview = await cdp.evaluate<string>(shown);
			await load(cdp, "about:blank");
			await load(cdp, `file://${output}#item/t7`);
			return { overview, open: await cdp.evaluate<string>(shown) };
		}, "print");
		expect(printed).toEqual({ overview: "overview about", open: "overview item about" });
	}, 60_000);
});

describe("a filled view in pack and check", () => {
	test("check --view all opens and captures each record", async () => {
		const output = await packed(
			"checked",
			FILLED.replace("records={items}", "records={items.slice(0, 3)}").replace(
				"<ul>{items",
				"<ul>{items.slice(0, 3)",
			),
		);
		const checked = await runCli([
			"check",
			output,
			"--quick",
			"--view",
			"all",
			"--out",
			dir.path("shots"),
		]);
		expect(checked.stdout).toContain("Views captured (4): #item/t1, #item/t2, #item/t3, #about");
		expect(checked.stdout).toContain("0 problems");
		expect(checked.code).toBe(0);
	}, 90_000);

	test("fails the pack, naming the view, for records it could not open or draw, and for a render that is not a client component", async () => {
		const failures = await Promise.all(
			[
				["no-id", "records={[{ name: 'x' }]} render={Item}"],
				["same-id", "records={[{ id: 1 }, { id: '1' }]} render={Item}"],
				["throws", "records={[{ id: 'ok' }, { id: 'bad' }]} render={Boom}"],
				["static", "records={items} render={(p) => <h1>{p.record.name}</h1>}"],
			].map(async ([name, props]) => {
				const source = FILLED.replace("records={items} render={Item}", props ?? "").replace(
					'import { Item } from "./item.tsx";',
					'import { Item } from "./item.tsx";\nimport { Boom } from "./boom.tsx";',
				);
				const { result } = await pack(`bad-${name}`, source, { "boom.tsx": BOOM });
				const message = result.stderr.trim().split("\n").at(-1) ?? "";
				return `${result.code} ${message.split("the page threw while rendering: ").at(-1)}`;
			}),
		);
		expect(failures).toEqual([
			'1 <View name="item" records>: record 0 has no id; give each record an id, the param that opens it (#item/<id>)',
			'1 <View name="item" records>: two records have the id "1"',
			'1 <View name="item" render={Boom}> threw for #item/bad: no such task',
			'1 <View name="item" render>: render must be a component from a module whose first line is "use client", since it draws in the browser',
		]);
	}, 60_000);
});
