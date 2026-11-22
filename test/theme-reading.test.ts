import { afterAll, expect, test } from "bun:test";
import { inPage, packedMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PHONE = WIDTHS[1] ?? { width: 390, height: 844, mobile: true };

test("a fold's question with inline math reads as one line of text that wraps inside the column on a phone", async () => {
	const output = await packedMdx(
		dir,
		"summary-math",
		"# Folds\n\n## Envelope\n\nText.\n\n<details>\n<summary>Why the factor $2$ at $m$ when the envelope of a single tone is symmetric?</summary>\n\nBecause.\n\n</details>\n",
	);
	const seen = await inPage(
		output,
		(cdp) =>
			cdp.evaluate<{ inside: boolean; lines: number; height: number }>(`(() => {
		const summary = document.querySelector("summary");
		const box = summary.getBoundingClientRect();
		const range = document.createRange();
		range.selectNodeContents(summary);
		const rects = [...range.getClientRects()].filter((r) => r.width > 0);
		return {
			inside: rects.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1) && document.documentElement.scrollWidth <= innerWidth,
			// The text's height in lines of the summary's line height: columns of words make it many lines tall.
			lines: (Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))) / parseFloat(getComputedStyle(summary).lineHeight),
			height: box.height,
		};
	})()`),
		PHONE,
	);
	expect(seen.inside).toBe(true);
	// About 80 characters take two lines of a phone's column; flex items set each run of words in a column of its own.
	expect(seen.lines).toBeLessThan(2.5);
	expect(seen.height).toBeGreaterThanOrEqual(44);
}, 30_000);

/** A page with every block the reading rhythm touches: sections, a fold ending one, tables, a figure and a view's chapters. */
const RHYTHM = `import { Table, View } from "kit";
import "./own.css";

# Rhythm

The lede.

## First

${"Words in a paragraph. ".repeat(20)}

<details>
<summary>Why?</summary>

Because.

</details>

## Sheet

| Quantity | Formula |
|---|---|
| Envelope | $A(t)=2[1+m x(t)]$, where $x(t)$ is the message normalised to a peak of one and $m$ the index |
| Carrier share | $P_0/P = 1/(1+m^2/2)$ |

<Table id="pairs" rows={[{ name: "Carrier", watts: 10 }, { name: "Sideband", watts: 2.5 }]} cols={[{ head: "Component", value: "name" }, { head: "Power (W)", value: "watts" }]} />

| A | B |
|---|---|
| 1 | 2 |

<table class="compare" id="grouped"><thead><tr><th>Part</th><th>Note</th></tr></thead><tbody><tr><th colSpan="2">Group</th></tr><tr><th scope="row">One</th><td>A</td></tr></tbody></table>

<Table id="outer" rows={[{ name: "Bridge" }]} cols={[{ head: "Part", value: "name" }, { head: "Readings", value: () => <table class="compare" id="nested"><tbody><tr><th scope="row">V</th><td>1</td><td>2</td></tr></tbody></table> }]} />

<p class="pairs">An author's own class for pairs.</p>

<figure>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A dot" width="300" height="200" />
<figcaption>A caption.</figcaption>
</figure>

---

## Before the band

Text.

<details id="before-band">
<summary>Why?</summary>

Because.

</details>

<section class="band">

## Act

Text.

</section>

## End

Text.

<details id="last-fold">
<summary>Why?</summary>

Because.

</details>

<View name="more">

## Chapter one

Text.

---

## Chapter two

Text.

</View>
`;

test("explicit chapter dividers, fold measure, phone tables and plain figures", async () => {
	const output = await packedMdx(dir, "rhythm", RHYTHM, { "own.css": ".pairs { display: grid; }" });
	const at = (viewport: typeof PHONE) =>
		inPage(
			output,
			(cdp) =>
				cdp.evaluate<Record<string, boolean>>(`(() => {
		const style = (el) => getComputedStyle(el);
		const sections = [...document.querySelectorAll("[data-overview] > section")];
		const [first, sheet] = sections;
		const [table, pairs, ab, grouped] = sheet.querySelectorAll("table");
		const chapters = [...document.querySelectorAll("section.view > section")];
		const figure = document.querySelector("figure");
		const phone = innerWidth < 640;
		const stacked = (t) => style(t.querySelector("tbody td")).display === "block";
		return {
			mastheadRule: style(document.querySelector(".masthead")).borderBottomWidth === "1px",
			spaceOnly: sections.concat(chapters).every((section) => style(section).borderTopWidth === "0px"),
			authoredRules: [sheet, chapters[0]].every((section) => {
				const hr = section.querySelector(":scope > hr:last-child");
				const rule = style(hr);
				return rule.borderBlockStartWidth === "1px" && rule.borderBlockEndWidth === "0px"
					&& rule.borderBlockStartColor === style(document.querySelector(".masthead")).borderBlockEndColor
					&& rule.marginBlockStart === style(section).marginBlockStart;
			}),
			foldEndsSection: [first.querySelector("details"), ...["before-band", "last-fold"].map((id) => document.getElementById(id))].every((fold) => style(fold).borderBottomWidth === "1px"),
			foldMeasure: Math.abs(document.querySelector("details").getBoundingClientRect().width - first.querySelector("p").getBoundingClientRect().width) < 1,
			tablesStack: [table, pairs, ab].every((t) => phone === stacked(t)),
			// A row that spans both columns makes a grouped table, which keeps its columns.
			groupedStays: !stacked(grouped),
			// A table nested in a stacking one's cell keeps its own columns.
			nestedStays: style(document.querySelector("#nested td")).display === "table-cell",
			// A page's own class reaches no table the kit marks to stack.
			ownClassApart: [table, pairs].every((t) => style(t).display !== "grid"),
			// Stacked, the value's column heading (a unit, say) still shows above the rows.
			headingShows: pairs.querySelector("thead th:last-child").getBoundingClientRect().height > 10,
			// Beside the text, a small table is as wide as its content.
			narrowTable: phone || ab.getBoundingClientRect().width < 250,
			noSideways: document.documentElement.scrollWidth <= innerWidth && table.parentElement.scrollWidth <= table.parentElement.clientWidth,
			figure: Math.abs(figure.getBoundingClientRect().left - first.getBoundingClientRect().left) < 1 && style(figure.querySelector("figcaption")).fontSize === "13px",
		};
	})()`),
			viewport,
		);
	const want = {
		mastheadRule: true,
		spaceOnly: true,
		authoredRules: true,
		foldEndsSection: true,
		foldMeasure: true,
		tablesStack: true,
		groupedStays: true,
		nestedStays: true,
		ownClassApart: true,
		headingShows: true,
		narrowTable: true,
		noSideways: true,
		figure: true,
	};
	for (const viewport of WIDTHS) {
		expect(await at(viewport)).toEqual(want);
	}
}, 30_000);
