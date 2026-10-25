import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Cdp, withPage } from "../skills/explainer/src/chrome.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Model code as an author writes it: 31 modulation indices and the envelope plot for each, 2 lines of 201 points. */
const MODEL = `export const ms = Array.from({ length: 31 }, (_, i) => +(i * 0.05).toFixed(2));
const ts = Array.from({ length: 201 }, (_, i) => i / 100);
export function envelope(m: number): PlotOption {
	const g = (t: number) => 1 + m * Math.cos(2 * Math.PI * t);
	return { series: [
		{ name: "g(t)", type: "line", data: ts.map((t) => [t, g(t)]) },
		{ name: "|g(t)|", type: "line", dash: true, data: ts.map((t) => [t, Math.abs(g(t))]) },
	] };
}
`;

const SLIDER = `---
reply: true
---
import { Explore } from "kit";
import { envelope, ms } from "./model.ts";

# Envelope

<Explore id="env" label="Envelope" controls={[{ id: "m", label: "Modulation index m", range: [0, 1.5, 0.05], value: 0.5 }]}
  base={{ plot: { y: { min: -1, max: 2.6 } }, caption: "Two periods of the tone." }}
  frames={ms.map((m) => ({ plot: envelope(m), readout: <>Follows g(t): <strong>{m <= 1 ? "yes" : "no"}</strong></> }))} />
`;

/** Two charts of hours by phase or person, with the reserve shown or hidden, and a stats row that toggles add to. */
const CHOICES = `import { Explore } from "kit";

export const bars = (names, reserve) => ({ xAxis: { type: "category", data: names }, yAxis: {},
  series: [{ type: "bar", data: names.map(() => 2) }, ...(reserve ? [{ type: "bar", data: names.map(() => 1) }] : [])] });

# Plan

<Explore id="plan" label="Hours" controls={[{ id: "by", label: "By", choice: ["Phase", "Person"], value: "Person" }, { id: "hide", label: "Hide the reserve", toggle: true }]}
  frames={[["a", "b"], ["x", "y", "z"]].map((names) => [bars(names, true), bars(names, false)].map((chart) => ({ chart })))} />

<Explore id="sum" controls={[{ id: "a", label: "Option A", toggle: true }, { id: "b", label: "Option B", toggle: true, value: true }]}
  base={{ stats: { "Fits": "yes" } }}
  frames={[0, 1].map((a) => [0, 1].map((b) => ({ stats: { "Total": \`\${100 + 20 * a + 35 * b} h\`, ...(a && b ? { "Fits": "no" } : {}) } })))} />
`;

/** Packs `source` as `<name>.mdx` beside the model; returns the output path and its HTML. */
async function pack(name: string, source: string) {
	dir.write("model.ts", MODEL);
	const output = dir.path(`${name}.out.html`);
	const result = await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	return { output, html: readFileSync(output, "utf8") };
}

/** The pack's exit code and message for a page with `body`. */
async function failure(name: string, body: string) {
	dir.write("model.ts", MODEL);
	const source = `import { Explore } from "kit";\nimport { envelope, ms } from "./model.ts";\n\n# Fails\n\n${body}\n`;
	const result = await runCli([
		"pack",
		dir.write(`${name}.mdx`, source),
		"-o",
		dir.path(`${name}.out.html`),
	]);
	return [result.code, result.stderr.trim()];
}

/** Waits for a frame, a task and another frame: Preact's render and the figure's redraw. */
const FRAMES = `new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50))).then(() => new Promise(requestAnimationFrame))`;

/** Opens `url`, or reloads keeping storage, and waits until the page has drawn. */
async function load(cdp: Cdp, url?: string) {
	const loaded = cdp.once("Page.loadEventFired");
	await (url ? cdp.send("Page.navigate", { url }) : cdp.send("Page.reload"));
	await loaded;
	await cdp.evaluate(`document.fonts.ready.then(() => ${FRAMES}).then(() => ${FRAMES})`, true);
}

/** Runs `action` in the page, waits for the redraw and returns `state`. */
const act = <T>(cdp: Cdp, action: string, state: string) =>
	cdp.evaluate<T>(
		`(() => { ${action} })(), ${FRAMES}.then(() => ${FRAMES}).then(() => (${state}))`,
		true,
	);

/** Opens a packed page in headless Chrome, `mobile` as a phone, and runs `fn`; fails on any page error or console warning. */
function inPage<T>(output: string, mobile: boolean, fn: (cdp: Cdp) => Promise<T>): Promise<T> {
	return withPage(async (cdp) => {
		const errors: string[] = [];
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
			errors.push(d.exception?.description ?? d.text),
		);
		cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
			if (type === "error" || type === "warning") {
				errors.push(`${type}: ${JSON.stringify(args)}`);
			}
		});
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		const size = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
		await cdp.send("Emulation.setDeviceMetricsOverride", { ...size, mobile, deviceScaleFactor: 1 });
		await load(cdp, `file://${output}`);
		const result = await fn(cdp);
		expect(errors).toEqual([]);
		return result;
	});
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
	test("a slider switches the plot and readout by keyboard and pointer, on a phone too, and its value comes back after a reload", async () => {
		const { output, html } = await pack("slider", SLIDER);
		expect(html).toContain("plot: small line, stem and bar plots");
		expect(html).not.toContain("Apache ECharts");
		const islands =
			/<script type="application\/json" id="explainer-islands">(.*?)<\/script>/s.exec(html)?.[1] ??
			"";
		// 31 frames of 2 × 201 points: kept to 1/10000 of the range and each a difference from the first, not 31 whole options.
		expect(islands.length).toBeLessThan(100_000);
		for (const mobile of [false, true]) {
			const state = await inPage(output, mobile, async (cdp) => {
				const first = await act(
					cdp,
					`window.firstLine = document.querySelector("#env svg path.line").getAttribute("d")`,
					SLIDER_STATE,
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
			});
			const caption = "Two periods of the tone.";
			expect(state).toEqual({
				first: ["0.5", "0.50", "Follows g(t): yes", true, true, caption],
				keyed: ["0.55", "0.55", "Follows g(t): yes", true, false, caption],
				dragged: ["1.5", "1.50", "Follows g(t): no", true, false, caption],
				reloaded: ["1.5", "1.50", "Follows g(t): no", true, false, caption],
			});
		}
	}, 60_000);

	test("a choice and a toggle switch a chart between nested frames, and toggles alone switch a stats row", async () => {
		const { output, html } = await pack("choices", CHOICES);
		expect(html).toContain("Apache ECharts");
		expect(html).not.toContain("plot: small line, stem and bar plots");
		const chart = `(() => { const o = echarts.getInstanceByDom(document.querySelector("#plan .chart")).getOption(); return o.xAxis[0].data.join("") + " " + o.series.length; })()`;
		const stats = `[...document.querySelectorAll("#sum .stat")].map((s) => s.textContent).join()`;
		const state = await inPage(output, false, async (cdp) => ({
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

	test("frames that do not match the controls, or hold what JSON cannot carry, fail the pack saying where", async () => {
		const slider = `controls={[{ id: "m", label: "m", range: [0, 1.5, 0.05] }]}`;
		expect(
			await failure(
				"short",
				`<Explore label="E" ${slider} frames={ms.slice(1).map((m) => ({ plot: envelope(m) }))} />`,
			),
		).toEqual([
			1,
			expect.stringContaining('<Explore> frames has 30 items, but control "m" has 31 values'),
		]);
		expect(
			await failure(
				"function",
				`<Explore label="E" ${slider} frames={ms.map((m) => ({ plot: { ...envelope(m), y: { format: (v) => v + " V" } } }))} />`,
			),
		).toEqual([1, expect.stringContaining("<Explore> frames[0].plot.y.format is not JSON")]);
		expect(
			await failure(
				"steps",
				`<Explore controls={[{ id: "m", label: "m", range: [0, 1, 0.3] }]} frames={[]} />`,
			),
		).toEqual([1, expect.stringContaining("needs max to be min plus whole steps")]);
	}, 30_000);
});
