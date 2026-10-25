import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Cdp, withPage } from "../skills/explainer/src/chrome.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/**
 * A client component as an agent writes one: scenario radios, a scale slider and a labels checkbox (all with ids, so kept),
 * a Stepper whose captions and step count follow the scenario, and a Chart and readout redrawn from the step.
 */
const QUEUE = `"use client";
import { useState } from "preact/hooks";
import { Chart, Stepper } from "kit";

const SCENARIOS = { calm: [2, 3, 4], burst: [2, 9, 14, 6, 3] };
type Scenario = keyof typeof SCENARIOS;

export function Queue() {
	const [scenario, setScenario] = useState<Scenario>("calm");
	const [scale, setScale] = useState(1);
	const [labels, setLabels] = useState(false);
	const [step, setStep] = useState(1);
	const shown = SCENARIOS[scenario].slice(0, step).map((n) => n * scale);
	return (
		<div>
			<div class="controls">
				{(Object.keys(SCENARIOS) as Scenario[]).map((name) => (
					<label>
						<input type="radio" name="scenario" id={\`scenario-\${name}\`} value={name} checked={name === scenario} onChange={() => setScenario(name)} /> {name}
					</label>
				))}
				<label class="field"><span>Scale</span><input type="range" id="scale" min="1" max="3" value={scale} onInput={(e) => setScale(Number(e.currentTarget.value))} /><output id="scale-out">×{scale}</output></label>
				<label><input type="checkbox" id="labels" checked={labels} onChange={(e) => setLabels(e.currentTarget.checked)} /> Labels</label>
			</div>
			<Stepper id="queue" start={1} label="Queue by hour" captions={SCENARIOS[scenario].map((n, i) => \`Hour \${i + 1}: \${n} waiting\`)} onStep={(n) => setStep(n)}>
				<p id="readout">{scenario} ×{scale}: {shown.join(" ")}</p>
				<Chart label="Waiting per hour" option={{ xAxis: { type: "category", data: shown.map((_, i) => \`h\${i + 1}\`) }, yAxis: { max: 50 }, series: [{ type: "bar", data: shown, label: { show: labels } }] }} />
			</Stepper>
		</div>
	);
}
`;

/** The page around Queue; `front` is its frontmatter body. */
const queuePage = (front: string) => `---
${front}
---
import { Queue } from "./queue.tsx";

# Queues

## By hour

<Queue />
`;

/** A static Stepper straight from the page, over hand-built SVG parts. */
const STATIC_STEPPER = `import { Stepper } from "kit";

# Steps

<Stepper id="s" start={1} captions={["one", "two", "three"]}>
  <svg viewBox="0 0 90 20" width="270"><rect id="a" data-step="1" width="20" height="20" /><rect id="b" data-step="2 3" x="35" width="20" height="20" /><rect id="c" data-step="3" x="70" width="20" height="20" /></svg>
</Stepper>
`;

/** A Plot straight from the page, and nothing that needs ECharts. */
const PLOT_PAGE = `import { Plot } from "kit";

# Calls

<Plot id="calls" label="Calls per day" option={{ categories: ["Mon", "Tue", "Wed"], series: [{ name: "Calls", type: "bar", data: [12, 18, 9], label: true }] }} />
`;

/** A client component that mounts a Stepper and a Chart only when the reader asks, and unmounts them again. */
const LATE = `"use client";
import { useState } from "preact/hooks";
import { Chart, Stepper } from "kit";

export function Late() {
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState(0);
	return (
		<div>
			<button type="button" class="btn" id="toggle" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
			<output id="late-step">{step}</output>
			{open && (
				<Stepper id="late" captions={["First", "Second"]} onStep={(n) => setStep(n)}>
					<p data-step="2">Second part</p>
					<Chart id="late-chart" label="Step" option={{ xAxis: { type: "category", data: ["step"] }, yAxis: { max: 2 }, series: [{ type: "bar", data: [step] }] }} />
				</Stepper>
			)}
		</div>
	);
}
`;

/** A Plot in the author's own client component, for a tick format (a function); the component imports nothing else from kit. */
const SPARK = `"use client";
import { Plot } from "kit";

export function Spark() {
	return <Plot id="spark" label="Load" option={{ series: [{ type: "line", data: [[0, 0.2], [1, 0.5], [2, 0.4]] }], y: { format: (v) => \`\${Math.round(v * 100)} %\` } }} />;
}
`;

/** Packs `source` as `<name>.mdx` beside the fixture components; returns the output path. */
async function pack(name: string, source: string): Promise<string> {
	dir.write("queue.tsx", QUEUE);
	dir.write("late.tsx", LATE);
	dir.write("spark.tsx", SPARK);
	const output = dir.path(`${name}.out.html`);
	const result = await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	return output;
}

/** Waits in the page until effects and the chart redraws they start have run: a frame, a task, another frame. */
const FRAMES = `new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50))).then(() => new Promise(requestAnimationFrame))`;

/** Opens `url` (or reloads, keeping storage) and waits until the page has settled: load, the kit's load tasks, the fonts and frames. */
async function load(cdp: Cdp, url?: string) {
	const loaded = cdp.once("Page.loadEventFired");
	await (url ? cdp.send("Page.navigate", { url }) : cdp.send("Page.reload"));
	await loaded;
	await cdp.evaluate(
		`new Promise((done) => setTimeout(done, 100)).then(() => document.fonts.ready).then(() => ${FRAMES})`,
		true,
	);
}

/** Runs `action` in the page, then waits for the re-render and returns the page's `state` expression. */
const act = <T>(cdp: Cdp, action: string, state: string) =>
	cdp.evaluate<T>(
		`(() => { ${action} })(), ${FRAMES}.then(() => ${FRAMES}).then(() => (${state}))`,
		true,
	);

/** Opens a packed page in headless Chrome with reduced motion and runs `fn`; fails on any uncaught page error or console warning. */
function inPage<T>(output: string, fn: (cdp: Cdp) => Promise<T>): Promise<T> {
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
		await cdp.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		await load(cdp, `file://${output}`);
		const result = await fn(cdp);
		expect(errors).toEqual([]);
		return result;
	});
}

/** The Queue island as the reader sees it, and whether steps.js's controls and root attributes survived Preact's renders. */
const QUEUE_STATE = `({
	step: document.querySelector("#queue .player output").textContent,
	caption: document.querySelector("#queue [data-captions] li.is-now")?.textContent,
	readout: document.getElementById("readout").textContent,
	bars: echarts.getInstanceByDom(document.querySelector("#queue .chart"))?.getOption().series[0].data.join(" "),
	labels: echarts.getInstanceByDom(document.querySelector("#queue .chart"))?.getOption().series[0].label.show,
	controls: [document.querySelector("[name=scenario]:checked").value, document.getElementById("scale").value, document.getElementById("labels").checked].join(),
	wired: document.querySelectorAll("#queue .player").length === 1 && document.querySelector("#queue .player").nextElementSibling.matches("[data-captions]") && document.getElementById("queue").matches("[data-live][role=group][tabindex='0'][aria-label='Queue by hour']"),
})`;

/** QUEUE_STATE's value for a scenario, scale and labels setting on `step` of `steps`; `shown` is what the readout and chart hold. */
const queue = (step: number, steps: number, caption: string, controls: string, shown: string) => {
	const [scenario, scale, labels] = controls.split(",");
	return {
		step: `${step} / ${steps}`,
		caption,
		readout: `${scenario} ×${scale}: ${shown}`,
		bars: shown,
		labels: labels === "true",
		controls,
		wired: true,
	};
};

describe("Stepper", () => {
	test("from the page, over static SVG parts, steps.js steps it without shipping Preact", async () => {
		const output = await pack("static-stepper", STATIC_STEPPER);
		const html = readFileSync(output, "utf8");
		expect(html).toContain('<figure class="fig" id="s" data-stepper data-start="1">');
		expect(html).toContain("<ol data-captions><li>one</li><li>two</li><li>three</li></ol>");
		expect(html).toContain("steps: stepper from attributes");
		expect(html).not.toContain("explainer-islands");
		const parts = `["a", "b", "c"].map((id) => document.getElementById(id).getAttribute("class") ?? "").join()`;
		const state = await inPage(output, async (cdp) => ({
			opening: await cdp.evaluate(parts),
			next: await act(cdp, `document.querySelector('[data-go="1"]').click()`, parts),
		}));
		expect(state).toEqual({ opening: "is-on is-now,,", next: "is-on,is-on is-now," });
	}, 30_000);

	test("captionsFirst puts the captions, and the controls over them, before the parts", async () => {
		const output = await pack(
			"captions-first",
			STATIC_STEPPER.replace("start={1}", "start={1} captionsFirst"),
		);
		const state = await inPage(output, async (cdp) => ({
			order: await cdp.evaluate(
				`[...document.getElementById("s").children].map((el) => el.getAttribute("class") ?? el.localName).join()`,
			),
			caption: await act(
				cdp,
				`document.querySelector('[data-go="1"]').click()`,
				`document.querySelector("[data-captions] .is-now").textContent`,
			),
		}));
		expect(state).toEqual({ order: "player,ol,svg", caption: "two" });
	}, 30_000);

	test("in a client component: onStep redraws the chart, a scenario switch changes the captions and count, nothing spins", async () => {
		const output = await pack("queue", queuePage("title: Queues"));
		const state = await inPage(output, async (cdp) => {
			const opening = await cdp.evaluate(QUEUE_STATE);
			// Every stepchange from here on, to show that a re-render does not start another.
			await cdp.evaluate(
				`window.heard = []; document.addEventListener("stepchange", (e) => heard.push(e.detail.step + "/" + e.detail.steps))`,
			);
			const next = await act(
				cdp,
				`const next = document.querySelector('[data-go="1"]'); next.focus(); next.click()`,
				`[${QUEUE_STATE}, document.activeElement === document.querySelector('[data-go="1"]')]`,
			);
			const burst = await act(
				cdp,
				`document.getElementById("scenario-burst").click()`,
				QUEUE_STATE,
			);
			const end = await act(
				cdp,
				`const root = document.getElementById("queue"); root.focus(); root.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))`,
				QUEUE_STATE,
			);
			const calm = await act(cdp, `document.getElementById("scenario-calm").click()`, QUEUE_STATE);
			const heard = await act(cdp, "", "heard");
			return { opening, next, burst, end, calm, heard };
		});
		expect(state.opening).toEqual(queue(1, 3, "Hour 1: 2 waiting", "calm,1,false", "2"));
		// Next keeps its focus: Preact's render does not move the controls steps.js inserted.
		expect(state.next).toEqual([queue(2, 3, "Hour 2: 3 waiting", "calm,1,false", "2 3"), true]);
		expect(state.burst).toEqual(queue(2, 5, "Hour 2: 9 waiting", "burst,1,false", "2 9"));
		expect(state.end).toEqual(queue(5, 5, "Hour 5: 3 waiting", "burst,1,false", "2 9 14 6 3"));
		// On the last step, a shorter scenario keeps it on the new last step.
		expect(state.calm).toEqual(queue(3, 3, "Hour 3: 4 waiting", "calm,1,false", "2 3 4"));
		expect(state.heard).toEqual(["2/3", "2/5", "5/5", "3/3"]);
	}, 30_000);

	test("check steps it and switches the scenario with no problems", async () => {
		const output = await pack("queue-checked", queuePage("title: Queues"));
		const checked = await runCli([
			"check",
			output,
			"--out",
			dir.path("queue-shots"),
			"--do",
			'click:[data-go="1"]',
			"--do",
			"click:#scenario-burst",
		]);
		expect(checked.stdout).toContain("0 problems");
		expect(checked.code).toBe(0);
	}, 90_000);
});

describe("Plot", () => {
	test("a page with only a Plot gets plot.js and no ECharts, and the plot draws", async () => {
		const output = await pack("plot", PLOT_PAGE);
		const html = readFileSync(output, "utf8");
		expect(html).toContain(
			'<div class="chart plot" id="calls" role="img" aria-label="Calls per day"></div>',
		);
		expect(html).toContain("plot: small line, stem and bar plots");
		expect(html).not.toContain("Apache ECharts");
		expect(html).not.toContain("charts: rich interactive charts");
		const drawn = await inPage(output, (cdp) =>
			cdp.evaluate(
				`[document.querySelectorAll("#calls svg .bar").length, document.querySelectorAll("#calls svg .value").length, document.getElementById("calls").className].join()`,
			),
		);
		expect(drawn).toBe("3,3,chart plot");
	}, 30_000);

	test("a Plot and a Chart from the page take formats and per-mark texts as JSON, written for the page's lang, as a Plot's numbers are without one", async () => {
		const output = await pack(
			"formats",
			`---
lang: sl
---
import { Chart, Plot } from "kit";

# Spekter

<Plot id="lines" label="Spekter" option={{ x: { min: 898, max: 902, step: 1, format: { unit: "kHz" } }, y: { min: 0, max: 1.25, step: 0.5, format: { digits: 1 } }, series: [{ type: "stem", data: [[899, 0.5], [900, 1], [901, 0.5]], label: ["½mA", "A", ""] }] }} />

<Plot id="shares" label="Deleži" option={{ categories: ["LC", "SC"], series: [{ type: "bar", data: [0.335, 1], label: { percent: true } }] }} />

<Chart id="waits" label="Čakanje" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: { axisLabel: { formatter: { digits: 1, unit: "min" } } }, tooltip: { valueFormatter: { currency: "EUR" } }, series: [{ type: "bar", data: [1, 2], label: { show: true, formatter: ["first", "second"] } }] }} />
`,
		);
		const texts = (id: string) =>
			`[...document.querySelectorAll("#${id} svg text")].map((t) => t.textContent)`;
		const state = await inPage(output, async (cdp) => ({
			lines: await cdp.evaluate<string[]>(texts("lines")),
			shares: await cdp.evaluate<string[]>(texts("shares")),
			chart: await cdp.evaluate(
				`(() => { const o = echarts.getInstanceByDom(document.getElementById("waits")).getOption(); return [o.yAxis[0].axisLabel.formatter(1.5), o.tooltip[0].valueFormatter(12345.5), o.series[0].label.formatter({ dataIndex: 1, value: 2 })]; })()`,
			),
		}));
		expect(state.lines).toEqual(expect.arrayContaining(["899\u00a0kHz", "0,5", "1,0", "½mA", "A"]));
		expect(state.lines.filter((t) => t === "")).toEqual([]);
		// Its axis has no format: the ticks are still written as the page's lang writes numbers.
		expect(state.shares).toEqual(expect.arrayContaining(["34\u00a0%", "100\u00a0%", "0,2"]));
		expect(state.chart).toEqual(["1,5\u00a0min", "12.345,50\u00a0€", "second"]);
	}, 30_000);

	test("a Plot in the author's client component brings plot.js alone, though kit also exports Chart", async () => {
		const output = await pack(
			"spark",
			'import { Spark } from "./spark.tsx";\n\n# Load\n\n<Spark />\n',
		);
		const html = readFileSync(output, "utf8");
		expect(html).toContain("plot: small line, stem and bar plots");
		expect(html).not.toContain("Apache ECharts");
		const ticks = await inPage(output, (cdp) =>
			cdp.evaluate(
				`[...document.querySelectorAll("#spark svg text")].some((t) => t.textContent === "50 %")`,
			),
		);
		expect(ticks).toBe(true);
	}, 30_000);
});

describe("lifecycle", () => {
	test("a Stepper and a Chart a client component mounts later work, and unmounting disposes the chart", async () => {
		const output = await pack("late", 'import { Late } from "./late.tsx";\n\n# Late\n\n<Late />\n');
		const html = readFileSync(output, "utf8");
		// Nothing in the first render needs steps.js or ECharts; the components the client code renders bring them.
		expect(html.slice(html.indexOf("<main"), html.indexOf("</main>"))).not.toContain(
			"data-stepper",
		);
		expect(html).toContain("steps: stepper from attributes");
		expect(html).toContain("Apache ECharts");
		const state = await inPage(output, async (cdp) => {
			const shown = await act(
				cdp,
				`document.getElementById("toggle").click()`,
				`[document.getElementById("late").matches("[data-live]"), document.querySelector("#late .player output").textContent, document.getElementById("late-step").textContent]`,
			);
			// The chart's option follows the step its first render could not know yet.
			const drawn = await act(
				cdp,
				`window.lateChart = document.getElementById("late-chart")`,
				`echarts.getInstanceByDom(lateChart)?.getOption().series[0].data.join()`,
			);
			const hidden = await act(
				cdp,
				`document.getElementById("toggle").click()`,
				`[lateChart.isConnected, echarts.getInstanceByDom(lateChart) === undefined]`,
			);
			return { shown, drawn, hidden };
		});
		expect(state).toEqual({ shown: [true, "2 / 2", "2"], drawn: "2", hidden: [false, true] });
	}, 30_000);
});

describe("in a hidden view", () => {
	test("a Chart and a Plot mount when the view is first shown", async () => {
		const output = await pack(
			"hidden",
			`import { Chart, Plot, View } from "kit";

# Detail

[Detail](#detail)

<View name="detail" back="Overview">

# Detail

<Chart id="hidden-chart" label="Bars" option={{ xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] }} />

<Plot id="hidden-plot" label="Bars" option={{ categories: ["a", "b"], series: [{ type: "bar", data: [1, 2] }] }} />

</View>
`,
		);
		const drawn = `[Boolean(echarts.getInstanceByDom(document.getElementById("hidden-chart"))), document.querySelectorAll("#hidden-plot svg .bar").length]`;
		const state = await inPage(output, async (cdp) => ({
			hidden: await cdp.evaluate(drawn),
			shown: await act(cdp, `location.hash = "#detail"`, drawn),
		}));
		expect(state).toEqual({ hidden: [false, 0], shown: [true, 2] });
	}, 30_000);
});

describe("keeping inside an island", () => {
	test("controlled controls come back after a reload with the island following them, and Clear resets them", async () => {
		const output = await pack("kept", queuePage("title: Queues\nreply: true"));
		const state = await inPage(output, async (cdp) => {
			await act(
				cdp,
				`document.getElementById("scenario-burst").click();
				const scale = document.getElementById("scale"); scale.value = "3"; scale.dispatchEvent(new Event("input", { bubbles: true }));
				document.getElementById("labels").click();`,
				"0",
			);
			await load(cdp);
			const reloaded = await cdp.evaluate(QUEUE_STATE);
			const clear = `document.querySelector(".reply-bar .btn:not(.primary)").click()`;
			await act(cdp, clear, "0");
			const cleared = await act(cdp, clear, QUEUE_STATE);
			return { reloaded, cleared };
		});
		expect(state.reloaded).toEqual(queue(1, 5, "Hour 1: 2 waiting", "burst,3,true", "6"));
		expect(state.cleared).toEqual(queue(1, 3, "Hour 1: 2 waiting", "calm,1,false", "2"));
	}, 30_000);

	test("without reply the controls are kept by keep.js alone, and no reply bar shows", async () => {
		const output = await pack("kept-alone", queuePage("title: Queues"));
		expect(scriptsIn(readFileSync(output, "utf8"))).toEqual(["echarts", "charts", "steps", "keep"]);
		const reloaded = await inPage(output, async (cdp) => {
			await act(cdp, `document.getElementById("scenario-burst").click()`, "0");
			await load(cdp);
			return cdp.evaluate(`[${QUEUE_STATE}.controls, document.querySelector(".reply-bar")]`);
		});
		expect(reloaded).toEqual(["burst,1,false", null]);
	}, 30_000);
});

/** The kit scripts a packed page includes, found by the documentation comment pack puts in front of each. */
const KIT_SCRIPTS = ["echarts", "charts", "plot", "views", "steps", "link", "keep", "reply"];
const scriptsIn = (html: string) => KIT_SCRIPTS.filter((name) => html.includes(`/* ${name}: `));

/** A client component that renders `jsx` (kit components from `imports`) only after #reveal is clicked. */
const revealing = (imports: string, jsx: string) => `"use client";
import { useState } from "preact/hooks";
import { ${imports} } from "kit";

export function Reveal() {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button type="button" class="btn" id="reveal" onClick={() => setOpen(true)}>Show</button>
			{open && ${jsx}}
		</div>
	);
}
`;

/** One use of each kit component, written so it needs every script the component can need (Tree: folds and refs). */
const COMPONENT_USES: Record<string, string> = {
	Chart: `<Chart label="Bars" option={{ xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] }} />`,
	Explore: `<Explore label="Bars" controls={[{ id: "n", label: "N", toggle: true }]} frame={(on) => ({ plot: { categories: ["a"], series: [{ type: "bar", data: [on ? 2 : 1] }] } })} />`,
	Plot: `<Plot label="Bars" option={{ categories: ["a"], series: [{ type: "bar", data: [1] }] }} />`,
	Question: `<Question name="pick" legend="Pick one" options={["yes", "no"]} />`,
	Stepper: `<Stepper captions={["One", "Two"]}><p data-step="1">One</p><p data-step="2">Two</p></Stepper>`,
	Table: `<Table rows={[{ name: "A", n: 1 }]} cols={[{ head: "Name", value: "name" }, { head: "N", value: "n" }]} />`,
	Tree: `<Tree items={[{ label: "Plan", ref: "plan", items: [{ label: "Task", ref: "plan", text: "Do it" }] }]} />`,
};

describe("kit scripts", () => {
	test("a Question a client component reveals after a click brings reply.js, and its answer is kept", async () => {
		dir.write(
			"ask.tsx",
			revealing(
				"Question",
				`<Question name="pick" legend="Pick one" options={{ yes: "Yes", no: "No" }} />`,
			),
		);
		const output = await pack(
			"ask",
			'import { Reveal } from "./ask.tsx";\n\n# Ask\n\n<Reveal />\n',
		);
		expect(scriptsIn(readFileSync(output, "utf8"))).toContain("reply");
		const kept = await inPage(output, async (cdp) => {
			const reveal = `document.getElementById("reveal").click()`;
			await act(cdp, reveal, "0");
			await act(cdp, `document.getElementById("pick-no").click()`, "0");
			await load(cdp);
			return act(cdp, reveal, `document.getElementById("pick-no").checked`);
		});
		expect(kept).toBe(true);
	}, 30_000);

	test("two Mermaid diagrams sharing a node id bring link.js, and the parts light together", async () => {
		const fence = (to: string) => `\`\`\`mermaid\nflowchart LR\n  A --> ${to}\n\`\`\`\n`;
		const output = await pack("shared", `# Shared\n\n${fence("B")}\n${fence("C")}`);
		expect(scriptsIn(readFileSync(output, "utf8"))).toContain("link");
		const lit = await inPage(output, (cdp) =>
			act(
				cdp,
				`document.querySelector('.mermaid [data-ref="A"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`,
				`[...document.querySelectorAll(".mermaid")].map((d) => d.querySelectorAll('.is-lit[data-ref="A"]').length > 0)`,
			),
		);
		expect(lit).toEqual([true, true]);
	}, 30_000);

	test("every kit component a client component renders later brings the scripts it brings when the page renders it", async () => {
		const exported = new Bun.Transpiler({ loader: "ts" }).scan(
			readFileSync(new URL("../skills/explainer/kit/components/index.ts", import.meta.url), "utf8"),
		).exports;
		// A View inside a client component fails the pack, so it is the one component without a later use.
		expect([...Object.keys(COMPONENT_USES), "View"].sort()).toEqual(exported.sort());
		const found = await Promise.all(
			Object.entries(COMPONENT_USES).map(async ([name, use]) => {
				dir.write(`later-${name}.tsx`, revealing(name, use));
				const [now, later] = await Promise.all([
					pack(`now-${name}`, `import { ${name} } from "kit";\n\n# Now\n\n${use}\n`),
					pack(
						`later-${name}`,
						`import { Reveal } from "./later-${name}.tsx";\n\n# Later\n\n<Reveal />\n`,
					),
				]);
				const [before, after] = [now, later].map((file) => scriptsIn(readFileSync(file, "utf8")));
				return [name, before?.filter((script) => !after?.includes(script))] as const;
			}),
		);
		expect(Object.fromEntries(found)).toEqual(
			Object.fromEntries(Object.keys(COMPONENT_USES).map((name) => [name, []])),
		);
	}, 60_000);
});

/** Packs `body` under a kit import as `<name>.mdx`, expecting a failure; returns the exit code and the message. */
async function packFailure(name: string, body: string) {
	const source = `import { Question } from "kit";\n\n# Ids\n\n${body}\n`;
	const result = await runCli([
		"pack",
		dir.write(`${name}.mdx`, source),
		"-o",
		dir.path(`${name}.out.html`),
	]);
	return [result.code, result.stderr.trim()];
}

describe("Question", () => {
	test("options whose values differ only in case keep their own answer across a reload, and the reply holds it", async () => {
		const output = await pack(
			"case",
			'import { Question } from "kit";\n\n# Case\n\n<Question name="pick" legend="Which one?" options={{ A: "Upper", a: "Lower" }} />\n',
		);
		const state = await inPage(output, async (cdp) => {
			await act(cdp, `document.querySelector('input[value="a"]').click()`, "0");
			await load(cdp);
			return act(
				cdp,
				`document.querySelector(".reply-bar .primary").click()`,
				`[[...document.querySelectorAll("input[name=pick]")].map((i) => i.checked).join(), document.querySelector(".reply-md").textContent.split("\\n").find((line) => line.includes("Which one?"))]`,
			);
		});
		expect(state).toEqual(["false,true", expect.stringContaining("Lower")]);
	}, 30_000);

	test("a value twice in one Question, or two Questions writing one id, fails the pack, saying what to change", async () => {
		const question = (name: string, options: string) =>
			`<Question name="${name}" legend="Which?" options={${options}} />`;
		const failed = packFailure;
		expect(await failed("twice", question("pick", '["Yes", "No", "Yes"]'))).toEqual([
			1,
			expect.stringContaining('<Question name="pick"> has the option value "Yes" twice'),
		]);
		expect(
			await failed("shared", `${question("a-b", '["c"]')}\n\n${question("a", '["b-c"]')}`),
		).toEqual([
			1,
			expect.stringContaining(
				'the id "a-b-c" is on 2 elements: <input type="radio" name="a-b" value="c"> under "Ids", <input type="radio" name="a" value="b-c"> under "Ids". A script, a label\'s for, a #link and a check --do step find only the first: give each its own id (a Question\'s option ids are its name and value, so give each Question its own name)',
			),
		]);
		expect(
			await failed("grouped", `${question("pick", '["Yes"]')}\n\n${question("pick", '["No"]')}`),
		).toEqual([1, expect.stringContaining('2 questions use the name "pick"')]);
	}, 30_000);
});

describe("self-check Question", () => {
	test("a self-check marks the choice, opens its explanation, keeps the choice after a reload, and is not in the reply", async () => {
		const output = await pack(
			"self-check",
			`import { Question } from "kit";

# Study

<Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">
A **kWh** is a kW for an hour.
</Question>

<Question name="unit2" legend="Which one is power?" options={["kW", "kWh"]} answer="kW" />
`,
		);
		expect(scriptsIn(readFileSync(output, "utf8"))).toEqual(["keep"]);
		// What the reader sees of the first question: the right and the chosen option's marks, and whether the explanation shows.
		const seen = `(() => {
			const look = (value) => { const s = getComputedStyle(document.querySelector('[name=unit][value="' + value + '"] + span')); return s.textDecorationLine + " " + s.boxShadow.includes("0px 0px 0px 2px"); };
			return [look("kW"), look("kWh"), document.querySelector(".explain").checkVisibility(), document.querySelector(".reply-bar")];
		})()`;
		const state = await inPage(output, async (cdp) => {
			const before = await cdp.evaluate(seen);
			const wrong = await act(cdp, `document.getElementById("unit-kW").click()`, seen);
			await load(cdp);
			return { before, wrong, reloaded: await cdp.evaluate(seen) };
		});
		expect(state.before).toEqual(["none false", "none false", false, null]);
		expect(state.wrong).toEqual(["line-through true", "none true", true, null]);
		expect(state.reloaded).toEqual(state.wrong);
	}, 30_000);

	test("a self-check with an answer that cannot be checked fails the pack, saying what to change", async () => {
		const question = (props: string, inside = "") =>
			`<Question name="q" legend="Which?" options={["a", "b"]} ${props}${inside ? `>${inside}</Question>` : " />"}`;
		const failed = (name: string, props: string, inside = "") =>
			packFailure(name, question(props, inside));
		expect(await failed("not-option", 'answer="c"')).toEqual([
			1,
			expect.stringContaining(
				'<Question name="q"> has the answer "c", which is not one of its option values (a, b)',
			),
		]);
		expect(await failed("multiple", 'answer="a" multiple')).toEqual([
			1,
			expect.stringContaining("a self-check has one right option"),
		]);
		expect(
			await packFailure("two-checks", `${question('answer="a"')}\n\n${question('answer="b"')}`),
		).toEqual([1, expect.stringContaining('2 questions use the name "q"')]);
		expect(await failed("no-answer", "", "Because.")).toEqual([
			1,
			expect.stringContaining("has an explanation inside but no answer"),
		]);
	}, 30_000);
});
