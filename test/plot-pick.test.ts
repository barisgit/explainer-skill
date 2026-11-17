import { afterAll, expect, test } from "bun:test";
import { shortTexts } from "../skills/explainer/kit/components/parts/short-texts.ts";
import { withTestPage } from "./browser.ts";
import { draw, plotDraw, rects, texts, width } from "./plot-draw.ts";
import { inPage, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const MONTHS = ["Jan", "Feb", "Mar", "Apr"];
const year = {
	categories: MONTHS,
	stack: true,
	y: { format: { unit: "kWh" } },
	series: [
		{ name: "from the roof", type: "bar", data: [100, 120, 160, 180] },
		{ name: "bought", type: "bar", data: [400, 300, 200, 100], fill: "hatch" },
	],
};

test("a picked category is framed, its name in ink, and the legend is its key: its name, then each series' value there (#190)", () => {
	const picked = { ...year, pick: 2 };
	const svg = draw(picked);
	const [frame, ...more] = rects(svg, "picked");
	expect(more).toEqual([]);
	// The frame surrounds the third column's two segments, 4 px out (a hatched bar's rect sits half its 1 px edge inside).
	const bars = [rects(svg, "bar")[2], rects(svg, "bar hatch")[2]].map((b) => b ?? []);
	const top = Math.min(...bars.map((b) => b[1] as number));
	const bottom = Math.max(...bars.map((b) => (b[1] as number) + (b[3] as number)));
	expect(Math.abs((frame?.[1] as number) - (top - 4))).toBeLessThanOrEqual(1);
	expect(
		Math.abs((frame?.[1] as number) + (frame?.[3] as number) - (bottom + 4)),
	).toBeLessThanOrEqual(1);
	expect(texts(svg, "picked").map((t) => t.text)).toEqual(["Mar"]);
	expect(rects(draw(year), "picked")).toEqual([]);

	const key = plotDraw.legendMarkup(picked, width, 300);
	expect(key).toContain('<li class="key-head">Mar</li>');
	expect(key).toContain('from the roof<span class="v">160\u00a0kWh</span>');
	expect(key).toContain('bought<span class="v">200\u00a0kWh</span>');
	// One named series is enough for a key.
	expect(plotDraw.legendMarkup({ ...picked, series: [year.series[0]] }, width, 300)).toContain(
		'<span class="v">160',
	);
	expect(plotDraw.legendMarkup({ ...picked, legend: false }, width, 300)).toBe("");
});

test("labels: false leaves an axis's tick labels out and gives their room to the plot", () => {
	const shown = draw(year);
	const unlabelled = { ...year, x: { labels: false } };
	const bare = draw(unlabelled);
	expect(shown).toContain(">Jan<");
	expect(bare).not.toContain(">Jan<");
	const base = (svg: string) =>
		Math.max(...rects(svg, "bar").map((b) => (b[1] as number) + (b[3] as number)));
	expect(base(bare)).toBeGreaterThan(base(shown) + 15);
});

/**
 * Page expression: each shown drawn copy's box height over the height pack drew it at, 1 where pack counted the legend's rows as
 * the browser wraps them (a copy's width scales with its box, its height is the plot area's).
 */
const DRAWN_SCALES = `[...document.querySelectorAll(".chart-drawn > svg")].filter((svg) => svg.getBoundingClientRect().width > 0).map((svg) => {
	const box = svg.parentElement.getBoundingClientRect();
	return box.height / Number(svg.getAttribute("viewBox").split(" ")[3]);
})`;

test("pack counts a key's rows as the browser sets its values, so a drawn key plot fits its box at the narrowest width", async () => {
	// Keys of growing values around where one row wraps into two in a 288 px figure; "1" is where digit widths differ most.
	const plots = [
		["one", "two"],
		["Own use", "Bought"],
	].flatMap((names) =>
		Array.from({ length: 12 }, (_, n) => {
			const v = Number("1".repeat(n + 1));
			const series = names.map((name) => ({ name, type: "bar", data: [v, v] }));
			return `<Plot label="Key" option={${JSON.stringify({ categories: ["a", "b"], pick: 0, series })}} />`;
		}),
	);
	const output = await packedMdx(
		dir,
		"key-rows",
		`import { Plot } from "kit";\n\n# Keys\n\n${plots.join("\n\n")}\n`,
	);
	const scales = await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 320,
			height: 800,
			mobile: true,
			deviceScaleFactor: 1,
		});
		await cdp.load(`file://${output}`);
		return cdp.evaluate<number[]>(DRAWN_SCALES);
	});
	expect(scales.length).toBeGreaterThan(3);
	for (const scale of scales) {
		expect(scale).toBeGreaterThan(0.98);
		expect(scale).toBeLessThan(1.02);
	}
}, 30_000);

test("a plot's text is set as wide as plot.js measures it, digits included, so what it fits it draws", async () => {
	const output = await packedMdx(
		dir,
		"digits",
		`import { Plot } from "kit";\n\n# Digits\n\n<Plot id="d" label="Digits" option={{ categories: ["1111", "2048"], series: [{ type: "bar", data: [1111111, 1111], label: true }] }} />\n`,
	);
	const gaps = await inPage(output, (cdp) =>
		cdp.evaluate<number[]>(`(() => {
			const ctx = document.createElement("canvas").getContext("2d");
			return [...document.querySelectorAll("#d .plot-area text")].map((text) => {
				const style = getComputedStyle(text);
				ctx.font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
				return Math.abs(text.getComputedTextLength() - ctx.measureText(text.textContent).width);
			});
		})()`),
	);
	expect(gaps.length).toBeGreaterThan(3);
	expect(Math.max(...gaps)).toBeLessThan(0.5);
}, 30_000);

test("a strip shortens names that are words, never values such as 4k7", () => {
	const codes = [
		"680",
		"820",
		"1k",
		"1k2",
		"1k5",
		"1k8",
		"2k2",
		"2k7",
		"3k3",
		"3k9",
		"4k7",
		"5k6",
		"6k8",
		"8k2",
		"10k",
	];
	expect(shortTexts(codes)).toEqual(codes);
	expect(shortTexts(["Jan", "Feb", "Mar", "Jun", "Jul"])).toEqual(["Ja", "F", "M", "Jun", "Jul"]);
});
