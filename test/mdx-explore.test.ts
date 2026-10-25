import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Cdp } from "../skills/explainer/src/chrome.ts";
import {
	act,
	FRAMES,
	inPage,
	load,
	packedMdx,
	packMdx,
	runCli,
	scratch,
	WIDTHS,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/**
 * Model code as an author writes it: the envelope frame for a modulation index, `points` points per line, its readout JSX and
 * its tick labels a function. As a "use client" module it runs in the browser; without the line, pack computes every frame.
 */
const model = (points: number, client: boolean) => `${client ? '"use client";\n' : ""}
const ts = Array.from({ length: ${points} }, (_, i) => (2 * i) / ${points - 1});
export function envelope(m: number) {
	const g = (t: number) => 1 + m * Math.cos(2 * Math.PI * t);
	return {
		plot: { y: { format: ${client ? '(v: number) => v.toFixed(1) + " V"' : '{ digits: 1, unit: "V" }'} }, series: [
			{ name: "g(t)", type: "line", data: ts.map((t) => [t, g(t)]) },
			{ name: "|g(t)|", type: "line", dash: true, data: ts.map((t) => [t, Math.abs(g(t))]) },
		] },
		readout: <>Follows g(t): <strong>{m <= 1 ? "yes" : "no"}</strong></>,
	};
}
`;

/** A slider over the envelope from `module`, its controls kept across reloads by keep.js with no reply: true. */
const slider = (module: string) => `import { Explore } from "kit";
import { envelope } from "./${module}";

# Envelope

<Explore id="env" label="Envelope" controls={[{ id: "m", label: "Modulation index m", range: [0, 1.5, 0.05], value: 0.5 }]}
  base={{ plot: { y: { min: -1, max: 2.6 } }, caption: "Two periods of the tone." }} frame={envelope} />
`;

/** Two charts of hours by phase or person, with the reserve shown or hidden, and a stats row that toggles add to. */
const CHOICES = `import { Explore } from "kit";

export const bars = (names, reserve) => ({ xAxis: { type: "category", data: names }, yAxis: {},
  series: [{ type: "bar", data: names.map(() => 2) }, ...(reserve ? [{ type: "bar", data: names.map(() => 1) }] : [])] });

# Plan

<Explore id="plan" label="Hours" controls={[{ id: "by", label: "By", choice: { phase: "Phase", person: "Person" }, value: "person" }, { id: "hide", label: "Hide the reserve", toggle: true }]}
  frame={(by, hide) => ({ chart: bars(by === "phase" ? ["a", "b"] : ["x", "y", "z"], !hide) })} />

<Explore id="sum" controls={[{ id: "a", label: "Option A", toggle: true }, { id: "b", label: "Option B", toggle: true, value: true }]}
  base={{ stats: { "Fits": "yes" } }}
  frame={(a, b) => ({ stats: { "Total": \`\${100 + 20 * a + 35 * b} h\`, ...(a && b ? { "Fits": "no" } : {}) } })} />
`;

/** Writes the models: client.tsx runs in the browser, packed.tsx and dense.tsx (1001 points a line) in pack. */
function writeModels() {
	dir.write("client.tsx", model(201, true));
	dir.write("packed.tsx", model(201, false));
	dir.write("dense.tsx", model(1001, false));
}

/** Packs `source` as `<name>.mdx` beside the models; returns the output path and its HTML. */
async function pack(name: string, source: string) {
	writeModels();
	const output = await packedMdx(dir, name, source);
	return { output, html: readFileSync(output, "utf8") };
}

/** The pack's exit code and message for a page with `body`. */
async function failure(name: string, body: string) {
	writeModels();
	const source = `import { Explore, Plot } from "kit";\n\n# Fails\n\n${body}\n`;
	const { result } = await packMdx(dir, name, source);
	return [result.code, result.stderr.trim()];
}

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

/** The slider page as the reader sees it: the slider, its output, the readout, the plot's first line and the caption. */
const SLIDER_STATE = `[document.getElementById("m").value, document.querySelector("output[for=m]").textContent,
	document.querySelector("#env > p").textContent, document.querySelector("#env svg path.line")?.getAttribute("d").length > 100,
	document.querySelector("#env svg path.line")?.getAttribute("d") === window.firstLine, document.querySelector("#env figcaption").textContent]`;

describe("Explore", () => {
	test("a slider whose frame a client module exports computes it in the browser: keyboard, input events, a phone, kept across a reload", async () => {
		const { output, html } = await pack("slider", slider("client.tsx"));
		expect(html).toContain("plot: small line, stem and bar plots");
		expect(html).not.toContain("Apache ECharts");
		expect(html).toContain("keep: ");
		expect(html).not.toContain("reply: ");
		const islands =
			/<script type="application\/json" id="explainer-islands">(.*?)<\/script>/s.exec(html)?.[1] ??
			"";
		// The page carries the controls and a reference to envelope, not 31 frames of points.
		expect(islands.length).toBeLessThan(2_000);
		for (const viewport of WIDTHS) {
			const state = await inPage(
				output,
				async (cdp) => {
					const first = await act(
						cdp,
						`window.firstLine = document.querySelector("#env svg path.line").getAttribute("d")`,
						`[...${SLIDER_STATE}, [...document.querySelectorAll("#env svg text")].some((t) => t.textContent === "1.0 V")]`,
					);
					await cdp.evaluate(`document.getElementById("m").focus()`);
					await press(cdp, "ArrowRight", 39);
					const keyed = await cdp.evaluate(SLIDER_STATE);
					const dragged = await act(
						cdp,
						`const m = document.getElementById("m"); m.value = "1.5"; m.dispatchEvent(new Event("input", { bubbles: true }))`,
						SLIDER_STATE,
					);
					await load(cdp);
					return { first, keyed, dragged, reloaded: await cdp.evaluate(SLIDER_STATE) };
				},
				viewport,
			);
			const caption = "Two periods of the tone.";
			expect(state).toEqual({
				first: ["0.5", "0.50", "Follows g(t): yes", true, true, caption, true],
				keyed: ["0.55", "0.55", "Follows g(t): yes", true, false, caption],
				dragged: ["1.5", "1.50", "Follows g(t): no", true, false, caption],
				reloaded: ["1.5", "1.50", "Follows g(t): no", true, false, caption],
			});
		}
	}, 60_000);

	test("a choice and a toggle switch a chart between frames computed in pack, and toggles alone switch a stats row", async () => {
		const { output, html } = await pack("choices", CHOICES);
		expect(html).toContain("Apache ECharts");
		expect(html).not.toContain("plot: small line, stem and bar plots");
		const chart = `(() => { const o = echarts.getInstanceByDom(document.querySelector("#plan .chart")).getOption(); return o.xAxis[0].data.join("") + " " + o.series.length; })()`;
		const stats = `[...document.querySelectorAll("#sum .stat")].map((s) => s.textContent).join()`;
		const state = await inPage(output, async (cdp) => ({
			start: [await cdp.evaluate(chart), await cdp.evaluate(stats)],
			chosen: await act(cdp, `document.getElementById("by-0").click()`, chart),
			hidden: await act(cdp, `document.getElementById("hide").click()`, chart),
			both: await act(cdp, `document.getElementById("a").click()`, stats),
		}));
		expect(state).toEqual({
			start: ["xyz 2", "Fitsyes,Total135 h"],
			chosen: "ab 2",
			hidden: "ab 1",
			both: "Fitsno,Total155 h",
		});
	}, 30_000);

	test("frames pack computes are JSON and at most 100 KB, and a frame it cannot draw fails the pack, each saying what to change", async () => {
		const controls = `controls={[{ id: "m", label: "m", range: [0, 1.5, 0.05] }]}`;
		const explore = (module: string, frame: string) =>
			`import { envelope } from "./${module}";\n\n<Explore label="E" ${controls} frame={${frame}} />`;
		// 31 frames of two 201-point lines: rounded and kept as differences from the first, they fit.
		expect(await failure("fits", explore("packed.tsx", "envelope"))).toEqual([0, ""]);
		expect(await failure("dense", explore("dense.tsx", "envelope"))).toEqual([
			1,
			expect.stringMatching(
				/<Explore> frames would take \d+ KB of the page: export frame from a module whose first line is "use client"/,
			),
		]);
		const formatted = `(m) => ({ plot: { ...envelope(m).plot, y: { format: (v) => v + " V" } } })`;
		expect(await failure("function", explore("packed.tsx", formatted))).toEqual([
			1,
			expect.stringContaining("<Explore> frame(0).plot.y.format is not JSON"),
		]);
		const throws = `(m) => { if (m > 1) throw new Error("no envelope"); return envelope(m); }`;
		expect(await failure("throws", explore("packed.tsx", throws))).toEqual([
			1,
			expect.stringContaining("<Explore> frame(1.05) threw: no envelope"),
		]);
		expect(
			await failure(
				"steps",
				`<Explore controls={[{ id: "m", label: "m", range: [0, 1, 0.3] }]} frame={() => ({})} />`,
			),
		).toEqual([1, expect.stringContaining("needs max to be min plus whole steps")]);
	}, 30_000);
});

describe("client exports as props", () => {
	test("a function a client module exports reaches a client component from the page; one from another module fails the pack", async () => {
		const volts = 'export const volts = (v: number) => v + " V";\n';
		dir.write("volts.ts", `"use client";\n${volts}`);
		dir.write("plain.ts", volts);
		const plot = (module: string) =>
			`import { Plot } from "kit";\nimport { volts } from "./${module}";\n\n# Volts\n\n<Plot id="v" label="Volts" option={{ y: { format: volts }, series: [{ type: "line", data: [[0, 1], [1, 2]] }] }} />\n`;
		const { output } = await pack("volts", plot("volts.ts"));
		const ticks = await inPage(output, (cdp) =>
			cdp.evaluate(
				`[...document.querySelectorAll("#v svg text")].some((t) => t.textContent === "1.5 V")`,
			),
		);
		expect(ticks).toBe(true);
		const failed = await runCli([
			"pack",
			dir.write("plain.mdx", plot("plain.ts")),
			"-o",
			dir.path("plain.out.html"),
		]);
		expect([failed.code, failed.stderr]).toEqual([
			1,
			expect.stringContaining(
				'<Plot option.y.format> is a function, but props from the page to a client component must be JSON or functions a "use client" module exports',
			),
		]);
	}, 30_000);
});
