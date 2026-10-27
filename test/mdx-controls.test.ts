import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { act, FRAMES, inPage, load, packedMdx, packMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const REPORT = join(import.meta.dir, "fixtures", "token-report");

/** Packs the token report fixture (page.mdx and its model) in place; returns the output path and its HTML. */
async function packReport() {
	const output = await packedMdx(dir, "report", readFileSync(join(REPORT, "page.mdx"), "utf8"), {
		"usage.ts": readFileSync(join(REPORT, "usage.ts"), "utf8"),
	});
	return { output, html: readFileSync(output, "utf8") };
}

/** What REPORT_STATE reads. */
interface ReportState {
	picked: string;
	days: number;
	series: number[];
	stats: string[];
	/** What each figure's line of chosen values says, and where its link goes. */
	says: string[];
	links: string[];
	overflow: boolean;
}

/** What the three figures of the report show: each chart's series and categories, and each figure's stats as text. */
const REPORT_STATE = `(() => {
	const [daily, ranking, cost] = [...document.querySelectorAll("figure.fig")];
	const option = (fig) => echarts.getInstanceByDom(fig.querySelector(".chart")).getOption();
	const stats = (fig) => [...fig.querySelectorAll(".stat")].map((s) => s.textContent).join("|");
	const picked = (name) => document.querySelector("input[name=" + name + "]:checked").value;
	return {
		picked: ["period", "host", "harness", "view"].map(picked).join(),
		days: option(daily).xAxis[0].data.length,
		series: [option(daily).series.length, option(ranking).series.length],
		stats: [stats(daily), stats(cost)],
		says: [...document.querySelectorAll(".controls-state")].map((p) => p.textContent),
		links: [...document.querySelectorAll(".controls-state a")].map((a) => a.getAttribute("href") + (document.querySelector(a.getAttribute("href")) ? " found" : " missing")),
		overflow: document.documentElement.scrollWidth > innerWidth,
	};
})()`;

/** Presses a key on the focused element, as a reader does. */
async function press(cdp: Cdp, key: string, keyCode: number) {
	for (const type of ["rawKeyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code: key,
			windowsVirtualKeyCode: keyCode,
		});
	}
	await cdp.evaluate(`${FRAMES}.then(() => ${FRAMES})`, true);
}

describe("shared controls", () => {
	test("one set of controls drives the figures of three sections, by click and keyboard, on desktop and phone, and is kept across a reload", async () => {
		const { output, html } = await packReport();
		// One row of controls for the page, and the starting frame of each figure drawn in the page.
		expect(html.match(/<div class="controls"/g)).toHaveLength(1);
		expect(
			html.match(/<div class="chart" role="img"[^>]*><div class="chart-drawn"[^>]*><svg/g),
		).toHaveLength(2);
		for (const viewport of WIDTHS) {
			const state = await inPage(
				output,
				async (cdp) => {
					const start = await cdp.evaluate<ReportState>(REPORT_STATE);
					const breakdown = await act<ReportState>(
						cdp,
						`document.getElementById("view-1").click()`,
						REPORT_STATE,
					);
					const week = await act<ReportState>(
						cdp,
						`document.getElementById("period-0").click()`,
						REPORT_STATE,
					);
					await cdp.evaluate(`document.getElementById("host-0").focus()`);
					await press(cdp, "ArrowRight", 39);
					const keyed = await cdp.evaluate<ReportState>(REPORT_STATE);
					await load(cdp);
					return {
						start,
						breakdown,
						week,
						keyed,
						reloaded: await cdp.evaluate<ReportState>(REPORT_STATE),
					};
				},
				viewport,
			);
			const { start, breakdown, week, keyed, reloaded } = state;
			expect([start, breakdown, week, keyed, reloaded].map((s) => s.overflow)).toEqual(
				Array(5).fill(false),
			);
			expect(start).toMatchObject({
				picked: "30 days,all,all,total",
				days: 30,
				series: [1, 1],
				// Each figure says what it shows and links to the controls, which sit above the first section.
				says: Array(3).fill("30 days All All Total"),
				links: Array(3).fill("#usage-controls found"),
			});
			// Breakdown splits the daily bars by model (4) and the ranking by kind of token (3); nothing else changes.
			expect(breakdown).toMatchObject({ days: 30, series: [4, 3], stats: start.stats });
			// A week keeps the breakdown and changes the days, the stats of the daily figure and of the cost figure.
			expect(week).toMatchObject({
				picked: "7 days,all,all,breakdown",
				days: 7,
				series: [4, 3],
				says: Array(3).fill("7 days All All Breakdown"),
			});
			expect(week.stats).not.toEqual(breakdown.stats);
			// The arrow key moves the host from "All" to Mac.
			expect(keyed).toMatchObject({
				picked: "7 days,Mac,all,breakdown",
				days: 7,
				series: [4, 3],
				says: Array(3).fill("7 days Mac All Breakdown"),
			});
			expect(keyed.stats).not.toEqual(week.stats);
			expect(reloaded).toEqual(keyed);
		}
	}, 90_000);
});

describe("shared controls with frames in the browser", () => {
	test("frames a client module exports run in the browser for every Explore of the set: a slider moves by keyboard, and a reload keeps it", async () => {
		const page = `import { Controls, Explore } from "kit";
import { curve, level } from "./live.tsx";

# Shared

<Controls id="mod" controls={[{ id: "m", label: "m", range: [0, 1.5, 0.05], value: 0.5 }, { id: "kind", label: "Kind", choice: ["AM", "FM"] }]} />

## Curve

<Explore use="mod" id="curve" label="Curve" base={{ plot: { y: { min: 0, max: 3 } } }} frame={curve} />

## Level

<Explore use="mod" id="level" frame={level} />
`;
		dir.write(
			"live.tsx",
			`"use client";
export const curve = (m: number, kind: string) => ({ plot: { series: [{ name: "g", type: "line", data: [[0, 0], [1, kind === "AM" ? m : 2 * m]] }] } });
export const level = (m: number, kind: string) => ({ readout: kind + " at " + m.toFixed(2) });
`,
		);
		const output = await packedMdx(dir, "live", page);
		const islands =
			/<script type="application\/json" id="explainer-islands">(.*?)<\/script>/s.exec(
				readFileSync(output, "utf8"),
			)?.[1] ?? "";
		// Each island carries its references to the frame, not the controls again.
		expect(islands.length).toBeLessThan(1_200);
		const seen = `[document.querySelector("#curve svg path.line").getAttribute("d"), document.querySelector("#level > p:not(.controls-state)").textContent, document.getElementById("m").value]`;
		const state = await inPage(output, async (cdp) => {
			const start = await cdp.evaluate<string[]>(seen);
			await cdp.evaluate(`document.getElementById("m").focus()`);
			await press(cdp, "ArrowRight", 39);
			const keyed = await cdp.evaluate<string[]>(seen);
			const chosen = await act<string[]>(cdp, `document.getElementById("kind-1").click()`, seen);
			await load(cdp);
			return { start, keyed, chosen, reloaded: await cdp.evaluate<string[]>(seen) };
		});
		expect(state.start.slice(1)).toEqual(["AM at 0.50", "0.5"]);
		expect(state.keyed.slice(1)).toEqual(["AM at 0.55", "0.55"]);
		expect(state.chosen.slice(1)).toEqual(["FM at 0.55", "0.55"]);
		expect(new Set([state.start[0], state.keyed[0], state.chosen[0]]).size).toBe(3);
		expect(state.reloaded).toEqual(state.chosen);
	}, 60_000);
});

describe("shared controls errors", () => {
	test("a use that names no Controls above it, two sets with one id, and a frame that fails a combination fail the pack, each saying what to write", async () => {
		const row = `controls={[{ id: "on", label: "On", toggle: true }]}`;
		const failure = async (name: string, body: string) => {
			const source = `import { Controls, Explore } from "kit";\n\n# Fails\n\n${body}\n`;
			const { result } = await packMdx(dir, name, source);
			return [result.code, result.stderr.trim()];
		};
		const figure = (use: string, frame = "() => ({ readout: 'x' })") =>
			`<Explore use="${use}" frame={${frame}} />`;
		expect(await failure("none", figure("usage"))).toEqual([
			1,
			expect.stringContaining('<Explore> use="usage" finds no <Controls id="usage"> above it'),
		]);
		expect(await failure("before", `${figure("a")}\n\n<Controls id="a" ${row} />`)).toEqual([
			1,
			expect.stringContaining('<Explore> use="a" finds no <Controls id="a"> above it'),
		]);
		expect(
			await failure("misspelt", `<Controls id="usage" ${row} />\n\n${figure("usge")}`),
		).toEqual([1, expect.stringContaining("(above it: usage)")]);
		expect(
			await failure(
				"both",
				`<Controls id="a" ${row} />\n\n<Explore use="a" ${row} frame={() => ({})} />`,
			),
		).toEqual([1, expect.stringContaining("<Explore> takes controls or use, not both")]);
		expect(
			await failure("twice", `<Controls id="a" ${row} />\n\n<Controls id="a" ${row} />`),
		).toEqual([1, expect.stringContaining('<Controls id="a"> is on the page twice')]);
		expect(await failure("empty", '<Controls id="a" controls={[]} />')).toEqual([
			1,
			expect.stringContaining('<Controls id="a"> needs controls'),
		]);
		expect(
			await failure(
				"throws",
				`<Controls id="a" ${row} />\n\n${figure("a", `(on) => { if (on) throw new Error("no data"); return {}; }`)}`,
			),
		).toEqual([1, expect.stringContaining("<Explore> frame(true) threw: no data")]);
		const dense = `(n) => ({ plot: { series: [{ type: "line", data: Array.from({ length: 4000 }, (_, i) => [i, Math.sin(i * n)]) }] } })`;
		expect(
			await failure(
				"dense",
				`<Controls id="a" controls={[{ id: "n", label: "N", range: [1, 6, 1] }]} />\n\n<Explore use="a" label="Dense" frame={${dense}} />`,
			),
		).toEqual([1, expect.stringMatching(/<Explore> frames would take \d+ KB of the page/)]);
	}, 60_000);
});

describe("the line of chosen values", () => {
	test("is left out of a figure right under its controls on screen, is in every figure in print, and a toggle says its label only while on", async () => {
		const page = `import { Controls, Explore } from "kit";

# State

<Controls id="set" controls={[{ id: "on", label: "Cached", toggle: true }, { id: "n", label: "Days", range: [1, 3, 1] }]} />

<Explore id="near" use="set" frame={(on, n) => ({ readout: on + " " + n })} />

Between the controls and the next figure.

<Explore id="far" use="set" frame={(on, n) => ({ readout: on + " " + n })} />
`;
		const output = await packedMdx(dir, "state", page);
		const lines = `["near", "far"].map((id) => { const p = document.querySelector("#" + id + " > .controls-state"); return p && p.offsetParent !== null ? p.textContent : "hidden"; })`;
		const state = await inPage(output, async (cdp) => {
			const start = await cdp.evaluate<string[]>(lines);
			const on = await act<string[]>(cdp, `document.getElementById("on").click()`, lines);
			await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
			return { start, on, printed: await cdp.evaluate<string[]>(lines) };
		});
		expect(state).toEqual({
			start: ["hidden", "Days 1"],
			on: ["hidden", "Cached Days 1"],
			printed: ["Cached Days 1", "Cached Days 1"],
		});
	}, 30_000);
});
