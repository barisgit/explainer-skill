import { afterAll, expect, test } from "bun:test";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { act, FRAMES, inPage, load, packedMdx, packMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const MODEL = `export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const months = Object.fromEntries(MONTHS.map((m, i) => [String(i), m]));
const ROOF = [99, 130, 166, 172, 174, 168, 173, 174, 164, 146, 115, 101];
const BOUGHT = [374, 282, 171, 88, 52, 35, 36, 48, 101, 194, 322, 403];
export const year = () => ({ plot: { categories: MONTHS, stack: true, y: { format: { unit: "kWh" } }, series: [
	{ name: "from the roof", type: "bar", data: ROOF },
	{ name: "bought", type: "bar", data: BOUGHT, fill: "hatch" },
] } });
`;

const PAGE = `import { Controls, Explore } from "kit";
import { months, year } from "./model.ts";

# Year

<Explore id="own" label="The year by month" controls={[{ id: "mon", label: "Month", choice: months, value: "11", axis: true }]} frame={year} />

## Shared

<Controls id="set" controls={[{ id: "m2", label: "Month", choice: months, value: "0", axis: true }]} />

<Explore id="follow" use="set" label="The year again" frame={year} />
`;

/** What the reader sees of the own Explore: the strip's chosen radio, the key's heading and the framed column's x. */
const OWN = `(() => {
	const fig = document.getElementById("own");
	return {
		checked: fig.querySelector(".plot-strip input:checked")?.id,
		head: fig.querySelector(".plot-legend .key-head")?.textContent,
		frame: Number(fig.querySelector("svg rect.picked")?.getAttribute("x")),
	};
})()`;

async function clickColumn(cdp: Cdp, figure: string, i: number) {
	const point = await cdp.evaluate<{ x: number; y: number }>(`(() => {
		const svg = document.querySelector("#${figure} .plot-area > svg");
		svg.scrollIntoView({ block: "center" });
		const bar = [...svg.querySelectorAll("rect.bar")][${i}].getBoundingClientRect();
		return { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
	})()`);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
	}
	await cdp.evaluate(FRAMES, true);
}

test("an axis choice is a strip under the columns, picked there, on a column and by arrow keys, kept across reloads (#190)", async () => {
	dir.write("model.ts", MODEL);
	const output = await packedMdx(dir, "year", PAGE);
	await inPage(output, async (cdp) => {
		expect(await cdp.evaluate(`document.querySelector("#own .controls")`)).toBe(null);
		expect(await cdp.evaluate(OWN)).toMatchObject({ checked: "mon-11", head: "Dec" });
		const lined = await cdp.evaluate<number[]>(`(() => {
			const label = document.querySelector("#own .plot-strip label").getBoundingClientRect();
			const bar = document.querySelector("#own svg rect.bar").getBoundingClientRect();
			return [label.x + label.width / 2, bar.x + bar.width / 2];
		})()`);
		expect(Math.abs((lined[0] as number) - (lined[1] as number))).toBeLessThan(1.5);
		// The columns' own names give way to the strip; a screen reader hears each place's values.
		expect(
			await cdp.evaluate(`document.querySelector("#own svg").innerHTML.includes(">Jan<")`),
		).toBe(false);
		expect(
			await cdp.evaluate(`document.getElementById("mon-2").getAttribute("aria-description")`),
		).toBe("from the roof 166\u00a0kWh, bought 171\u00a0kWh");

		await clickColumn(cdp, "own", 1);
		const clicked = await cdp.evaluate<{ checked: string; head: string; frame: number }>(OWN);
		expect(clicked).toMatchObject({ checked: "mon-1", head: "Feb" });

		await cdp.evaluate(`document.getElementById("mon-1").focus()`);
		for (const type of ["rawKeyDown", "keyUp"]) {
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "ArrowRight",
				code: "ArrowRight",
				windowsVirtualKeyCode: 39,
			});
		}
		await cdp.evaluate(FRAMES, true);
		const keyed = await cdp.evaluate<{ checked: string; head: string; frame: number }>(OWN);
		expect(keyed).toMatchObject({ checked: "mon-2", head: "Mar" });
		expect(keyed.frame).toBeGreaterThan(clicked.frame);

		await load(cdp);
		expect(await cdp.evaluate(OWN)).toMatchObject({ checked: "mon-2", head: "Mar" });

		// Following a Controls: no second strip, the columns keep their names, and a click picks in the shared set.
		expect(await cdp.evaluate(`document.querySelector("#follow .plot-strip")`)).toBe(null);
		expect(
			await cdp.evaluate(`document.querySelector("#follow svg").innerHTML.includes(">Jan<")`),
		).toBe(true);
		await clickColumn(cdp, "follow", 4);
		expect(
			await act(
				cdp,
				"",
				`[document.querySelector("#set-controls input:checked").id, document.querySelector("#follow .key-head").textContent]`,
			),
		).toEqual(["m2-4", "May"]);
	});
}, 60_000);

/** Page expression: what each label of a figure's strip shows (its CSS text, "" for none), and its radios. */
const STRIP = (figure: string) => `(() => {
	const labels = [...document.querySelectorAll("#${figure} .plot-strip label")];
	return {
		shown: labels.map((label) => {
			const full = label.querySelector(".full");
			if (full && getComputedStyle(full).display !== "none") return full.textContent;
			const after = getComputedStyle(label, "::after").content;
			return after === "none" || after === "normal" ? "" : JSON.parse(after);
		}),
		shorts: labels.map((label) => label.dataset.short),
		radios: document.querySelectorAll("#${figure} .plot-strip input[type=radio]").length,
	};
})()`;

/** Expects a strip to show its labels' short forms at every nth from the first, none between; returns n. */
function expectEvery({ shown, shorts }: { shown: string[]; shorts: string[] }) {
	const at = shown.flatMap((text, i) => (text ? [i] : []));
	const every = (at[1] ?? shown.length) - (at[0] ?? 0);
	expect(at).toEqual(Array.from({ length: Math.ceil(shown.length / every) }, (_, k) => k * every));
	expect(at.map((i) => shown[i])).toEqual(at.map((i) => shorts[i]));
	return every;
}

const DAYS = `import { Explore } from "kit";
import { months, year } from "./model.ts";

# Strips

<Explore id="own" label="The year by month" controls={[{ id: "mon", label: "Month", choice: months, value: "11", axis: true }]} frame={year} />

<Explore id="days" label="Days" controls={[{ id: "day", label: "Day", choice: Array.from({ length: 31 }, (_, i) => String(i + 1)), axis: true }]} frame={() => ({ plot: { categories: Array.from({ length: 31 }, (_, i) => String(i + 1)), series: [{ type: "bar", data: Array.from({ length: 31 }, (_, i) => i) }] } })} />
`;

test("on a phone, a strip too narrow for its texts shows names by their shortest distinct start and whole numbers, every nth when they do not fit", async () => {
	dir.write("model.ts", MODEL);
	const output = await packedMdx(dir, "year-phone", DAYS);
	const phone = WIDTHS[1];
	if (!phone) {
		throw new Error("no phone width");
	}
	const [months, days] = await inPage(
		output,
		(cdp) =>
			Promise.all([
				cdp.evaluate<{ shown: string[]; shorts: string[] }>(STRIP("own")),
				cdp.evaluate<{ shown: string[]; shorts: string[]; radios: number }>(STRIP("days")),
			]),
		phone,
	);
	// Names by their shortest start no other month shares, every nth where even those touch.
	expect(months.shorts).toEqual([
		"Ja",
		"F",
		"Mar",
		"Ap",
		"May",
		"Jun",
		"Jul",
		"Au",
		"S",
		"O",
		"N",
		"D",
	]);
	expectEvery(months);
	// Every day keeps its radio; the labels shown are whole numbers, evenly spaced.
	expect(days.radios).toBe(31);
	expect(days.shorts).toEqual(days.shorts.map((_, i) => String(i + 1)));
	expect(expectEvery(days)).toBeGreaterThan(1);
}, 30_000);

test("a reply names a strip's choice by its full text, on a phone too", async () => {
	dir.write("model.ts", MODEL);
	const output = await packedMdx(
		dir,
		"year-reply",
		`import { Explore } from "kit";
import { months, year } from "./model.ts";

# Reply

<fieldset data-reply aria-label="Month">
<Explore id="own" label="The year by month" controls={[{ id: "mon", label: "Month", choice: months, value: "11", axis: true }]} frame={year} />
</fieldset>
`,
	);
	const phone = WIDTHS[1];
	if (!phone) {
		throw new Error("no phone width");
	}
	const reply = await inPage(output, (cdp) => cdp.evaluate<string>("ReplyNotes.markdown()"), phone);
	expect(reply).toContain("Month: Dec (default)");
}, 30_000);

test("pack fails for an axis choice whose frames draw no columns, one per choice", async () => {
	dir.write("model.ts", MODEL);
	const fails = async (name: string, explore: string) => {
		const { result } = await packMdx(
			dir,
			name,
			`import { Explore } from "kit";\nimport { months, year } from "./model.ts";\n\n# Fails\n\n${explore}\n`,
		);
		return [result.code, result.stderr.trim()];
	};
	expect(
		await fails(
			"axis-rows",
			`<Explore label="Rows" controls={[{ id: "a", label: "Month", choice: months, axis: true }]} frame={() => ({ plot: { ...year().plot, horizontal: true } })} />`,
		),
	).toEqual([
		1,
		expect.stringContaining(
			'control "a" has axis: true, so frame("0") returns a plot of columns, one category per choice: categories with 12 names, not horizontal',
		),
	]);
	expect(
		await fails(
			"axis-two",
			`<Explore label="Two" controls={[{ id: "a", label: "A", choice: months, axis: true }, { id: "b", label: "B", choice: months, axis: true }]} frame={year} />`,
		),
	).toEqual([1, expect.stringContaining('controls "a" and "b" both have axis: true')]);
}, 30_000);

test("stats whose terms change from frame to frame show each frame's own terms (#201)", async () => {
	const output = await packedMdx(
		dir,
		"stats",
		`import { Explore } from "kit";

# Stats

<Explore id="s" controls={[{ id: "k", label: "Month", choice: ["Jan", "Feb", "Mar"] }]} frame={(m) => ({ stats: { [m]: "1 kWh" } })} />
`,
	);
	await inPage(output, async (cdp) => {
		const terms = `[...document.querySelectorAll("#s dt")].map((t) => t.textContent)`;
		expect(await cdp.evaluate(terms)).toEqual(["Jan"]);
		expect(await act(cdp, `document.getElementById("k-2").click()`, terms)).toEqual(["Mar"]);
	});
}, 30_000);
