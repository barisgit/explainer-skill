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
		picked: labels.findIndex((label) => label.querySelector("input:checked")),
		radios: document.querySelectorAll("#${figure} .plot-strip input[type=radio]").length,
	};
})()`;

/** Expects a strip to show its labels' short forms at every nth from the first, none between, and the picked one's
   always, its neighbours nearer than n left out; returns n. */
function expectEvery({
	shown,
	shorts,
	picked,
}: {
	shown: string[];
	shorts: string[];
	picked: number;
}) {
	const at = shown.flatMap((text, i) => (text ? [i] : []));
	const every = Math.min(...at.slice(1).map((i, k) => i - (at[k] ?? 0)), shown.length);
	const nth = Array.from({ length: Math.ceil(shown.length / every) }, (_, k) => k * every);
	const expected = [...nth.filter((i) => Math.abs(i - picked) >= every), picked].sort(
		(a, b) => a - b,
	);
	expect(at).toEqual(expected);
	expect(at.map((i) => shown[i])).toEqual(at.map((i) => shorts[i]));
	return every;
}

type Strip = { shown: string[]; shorts: string[]; picked: number; radios: number };

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
		(cdp) => Promise.all([cdp.evaluate<Strip>(STRIP("own")), cdp.evaluate<Strip>(STRIP("days"))]),
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
	// December is picked: its own label shows, and November, which would touch it, does not.
	expect(months.picked).toBe(11);
	expect(expectEvery(months)).toBeGreaterThan(1);
	// Every day keeps its radio; the labels shown are whole numbers, evenly spaced.
	expect(days.radios).toBe(31);
	expect(days.shorts).toEqual(days.shorts.map((_, i) => String(i + 1)));
	expect(expectEvery(days)).toBeGreaterThan(1);
	// A pick elsewhere moves the label shown with it.
	const feb = await inPage(
		output,
		async (cdp) => {
			return act<Strip>(cdp, `document.getElementById("mon-1").click()`, STRIP("own"));
		},
		phone,
	);
	expect(feb.picked).toBe(1);
	expectEvery(feb);
}, 30_000);

test("a strip marks its picked and focused choice in the ink of the column's frame", async () => {
	dir.write("model.ts", MODEL);
	const output = await packedMdx(dir, "year-ink", PAGE);
	const colours = await inPage(output, async (cdp) => {
		await cdp.evaluate(`document.getElementById("mon-11").focus({ focusVisible: true })`);
		return cdp.evaluate<string[]>(`(() => {
			const label = document.querySelector("#own .plot-strip label:has(input:checked)");
			const style = getComputedStyle(label);
			return [style.borderTopColor, style.outlineColor, getComputedStyle(document.querySelector("#own svg rect.picked")).stroke];
		})()`);
	});
	expect(new Set(colours).size).toBe(1);
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

const HOVER_PAGE = `import { Controls, Explore } from "kit";
import { months, year } from "./model.ts";

# Year

<Explore id="own" label="The year by month" controls={[{ id: "mon", label: "Month", choice: months, value: "11", axis: true }]} frame={year} />

## Shared

<Controls id="set" controls={[{ id: "m2", label: "Month", choice: months, value: "0", axis: true }]} />

<Explore id="follow" use="set" label="The year again" frame={year} />

<Explore id="also" use="set" label="The year once more" frame={year} />
`;

/** Page expression: what a figure shows of its column, and the value its control holds. */
const SHOWN = (figure: string, control: string) => `(() => {
	const fig = document.getElementById("${figure}");
	const legend = fig.querySelector(".plot-legend");
	return {
		checked: document.querySelector("input[name=${control}]:checked")?.id,
		head: legend.querySelector(".key-head")?.textContent,
		values: [...legend.querySelectorAll(".v")].map((v) => v.textContent),
		frame: Math.round(Number(fig.querySelector("svg rect.picked")?.getAttribute("x"))),
		legend: legend.getBoundingClientRect().height,
		area: fig.querySelector(".plot-area").getBoundingClientRect().height,
	};
})()`;
type Shown = {
	checked: string;
	head: string;
	values: string[];
	frame: number;
	legend: number;
	area: number;
};

/** The centre of a figure's ith column bar (or, with `strip`, of its ith strip label) in the viewport, scrolled to the middle. */
const centre = (cdp: Cdp, figure: string, i: number, strip = false) =>
	cdp.evaluate<{ x: number; y: number }>(`(() => {
		const fig = document.getElementById("${figure}");
		fig.scrollIntoView({ block: "center" });
		const box = [...fig.querySelectorAll("${strip ? ".plot-strip label" : "svg rect.bar"}")][${i}].getBoundingClientRect();
		return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
	})()`);

/** Moves a mouse (or `pointerType` pen) with no button held to `point`, then waits two frames. */
async function hover(cdp: Cdp, point: { x: number; y: number }) {
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
	await cdp.evaluate(FRAMES, true);
}

test("hovering a column or its strip label previews its frame and key at once; only a click picks, and touch never previews", async () => {
	dir.write("model.ts", MODEL);
	const output = await packedMdx(dir, "year-hover", HOVER_PAGE);
	await inPage(output, async (cdp) => {
		const own = SHOWN("own", "mon");
		const rest = await cdp.evaluate<Shown>(own);
		expect(rest).toMatchObject({ checked: "mon-11", head: "Dec" });

		// A hovered column: its name and values in the key and the frame around it, drawn at once; the pick stays.
		await hover(cdp, await centre(cdp, "own", 3));
		const april = await cdp.evaluate<Shown>(own);
		expect(april).toMatchObject({
			checked: "mon-11",
			head: "Apr",
			values: ["172\u00a0kWh", "88\u00a0kWh"],
			legend: rest.legend,
			area: rest.area,
		});
		expect(april.frame).toBeLessThan(rest.frame);
		// The picked column keeps its strip mark while the frame is elsewhere.
		expect(
			await cdp.evaluate(
				`document.querySelector("#own .plot-strip label:has(input:checked)").dataset.full`,
			),
		).toBe("Dec");

		// A hovered strip label previews its column too.
		await hover(cdp, await centre(cdp, "own", 5, true));
		expect(await cdp.evaluate<Shown>(own)).toMatchObject({ checked: "mon-11", head: "Jun" });

		// Leaving the plot shows the picked column again.
		await hover(cdp, { x: 2, y: 2 });
		expect(await cdp.evaluate<Shown>(own)).toEqual(rest);

		// A click picks the hovered column.
		await clickColumn(cdp, "own", 3);
		expect(await cdp.evaluate<Shown>(own)).toMatchObject({ checked: "mon-3", head: "Apr" });

		// A finger moving on a column previews nothing; its tap picks, leaving no preview behind.
		await hover(cdp, { x: 2, y: 2 });
		const finger = await centre(cdp, "own", 7);
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger] });
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x: finger.x + 2, y: finger.y }],
		});
		await cdp.evaluate(FRAMES, true);
		expect(await cdp.evaluate<Shown>(own)).toMatchObject({ checked: "mon-3", head: "Apr" });
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		await cdp.evaluate(FRAMES, true);
		expect(await cdp.evaluate<Shown>(own)).toMatchObject({ checked: "mon-7", head: "Aug" });
		await cdp.evaluate(`document.getElementById("mon-1").click()`);
		await cdp.evaluate(FRAMES, true);
		expect(await cdp.evaluate<Shown>(own)).toMatchObject({ checked: "mon-1", head: "Feb" });

		// A figure following a Controls previews on its own: the shared choice and the other figure stay.
		await hover(cdp, await centre(cdp, "follow", 4));
		expect(await cdp.evaluate<Shown>(SHOWN("follow", "m2"))).toMatchObject({
			checked: "m2-0",
			head: "May",
		});
		// Its columns keep their names: the picked one's stays in ink while the frame is on the hovered one.
		expect(
			await cdp.evaluate(`document.querySelector("#follow svg text.picked")?.textContent`),
		).toBe("Jan");
		expect(await cdp.evaluate<Shown>(SHOWN("also", "m2"))).toMatchObject({
			checked: "m2-0",
			head: "Jan",
		});
	});
}, 60_000);

test("a preview ends on print, on leaving the window or tab, and a disposed plot's strip previews nothing", async () => {
	dir.write("model.ts", MODEL);
	const output = await packedMdx(dir, "year-end", HOVER_PAGE);
	await inPage(output, async (cdp) => {
		const own = SHOWN("own", "mon");
		const rest = await cdp.evaluate<Shown>(own);
		for (const end of [
			`dispatchEvent(new Event("beforeprint"))`,
			`dispatchEvent(new Event("blur"))`,
			`document.dispatchEvent(new Event("visibilitychange"))`,
		]) {
			await hover(cdp, await centre(cdp, "own", 3));
			expect(await cdp.evaluate<Shown>(own)).toMatchObject({ head: "Apr" });
			await cdp.evaluate(end);
			await cdp.evaluate(FRAMES, true);
			expect(await cdp.evaluate<Shown>(own)).toMatchObject({ head: rest.head, frame: rest.frame });
			await hover(cdp, { x: 2, y: 2 });
		}

		// A plot made with a strip and disposed: a mouse over the strip leaves it as it was.
		await cdp.evaluate(`(() => {
			const made = Object.assign(document.createElement("div"), { id: "made" });
			const box = Object.assign(document.createElement("div"), { className: "chart" });
			box.style.blockSize = "300px";
			const strip = Object.assign(document.createElement("div"), { className: "plot-strip" });
			strip.innerHTML = '<label data-full="A" data-short="A"><input type="radio" name="made"><span class="full">A</span></label><label data-full="B" data-short="B"><input type="radio" name="made"><span class="full">B</span></label>';
			made.append(box, strip);
			document.querySelector("main").append(made);
			const option = { categories: ["A", "B"], pick: 0, series: [{ name: "s", type: "bar", data: [1, 2] }] };
			Plot.make(box, option, { choose() {}, strip }).dispose();
		})()`);
		await hover(cdp, await centre(cdp, "made", 1, true));
		expect(await cdp.evaluate(`document.querySelector("#made .key-head").textContent`)).toBe("A");
	});
}, 60_000);

test("an axis choice's key keeps the room of its tallest column, so neither a preview nor a pick moves or covers the plot", async () => {
	dir.write(
		"long.ts",
		`const NAMES = ["A", "A considerably longer category"];
export const names = { a: NAMES[0], b: NAMES[1] };
export const two = () => ({ plot: { categories: NAMES, series: [
	{ name: "Roof generation", type: "bar", data: [120, 340] },
	{ name: "Purchased electricity", type: "bar", data: [80, 1260] },
] } });
`,
	);
	const output = await packedMdx(
		dir,
		"long-key",
		`import { Explore } from "kit";
import { names, two } from "./long.ts";

# Long

<Explore id="long" label="Two columns" controls={[{ id: "c", label: "Column", choice: names, axis: true }]} frame={two} />
`,
	);
	/** The plot area's box and how far the legend's items reach below its top (negative: clear of it). */
	const room = `(() => {
		const fig = document.getElementById("long");
		const area = fig.querySelector(".plot-area").getBoundingClientRect();
		const reach = Math.max(...[...fig.querySelectorAll(".plot-legend > li")].map((li) => li.getBoundingClientRect().bottom));
		return { top: Math.round(area.top), height: Math.round(area.height), over: reach - area.top };
	})()`;
	type Room = { top: number; height: number; over: number };
	await inPage(
		output,
		async (cdp) => {
			await centre(cdp, "long", 0);
			const rest = await cdp.evaluate<Room>(room);
			expect(rest.over).toBeLessThanOrEqual(0.5);
			await hover(cdp, await centre(cdp, "long", 1));
			const hovered = await cdp.evaluate<Room>(room);
			expect(hovered.over).toBeLessThanOrEqual(0.5);
			expect([hovered.top, hovered.height]).toEqual([rest.top, rest.height]);
			await clickColumn(cdp, "long", 1);
			await hover(cdp, { x: 2, y: 2 });
			const picked = await cdp.evaluate<Room>(room);
			expect(picked.over).toBeLessThanOrEqual(0.5);
			expect([picked.top, picked.height]).toEqual([rest.top, rest.height]);
		},
		{ width: 500, height: 900, mobile: false },
	);
}, 60_000);

test("pack draws a picked plot only where its key has the room of its tallest category's, as plot.js keeps it", async () => {
	const plot = (id: string, long: string) =>
		`<Plot id="${id}" label="${id}" option={{ categories: ["A", "${long}"], pick: 0, series: [{ name: "Roof", type: "bar", data: [120, 340] }, { name: "Grid", type: "bar", data: [80, 1260] }] }} />`;
	const output = await packedMdx(
		dir,
		"key-room",
		`import { Plot } from "kit";\n\n# Keys\n\n${plot("short", "B")}\n\n${plot("long", "A considerably longer category")}\n`,
	);
	const html = await Bun.file(output).text();
	const drawn = (id: string) => new RegExp(`id="${id}"[^>]*><ul class="plot-legend">`).test(html);
	// The long name's key wraps into more rows than the picked one's on a phone: that figure is left to plot.js.
	expect([drawn("short"), drawn("long")]).toEqual([true, false]);
});
