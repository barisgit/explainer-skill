import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act, inPage, kitScriptsIn, load, packedMdx, runCli, scratch } from "./support.ts";

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
	return packedMdx(dir, name, source);
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
		// pack drew it: the legend (empty for one series) and the drawn copies, for plot.js to draw over.
		expect(html).toContain(
			'<div class="chart plot" id="calls" role="img" aria-label="Calls per day"><ul class="plot-legend"></ul><div class="plot-area"><div class="chart-drawn" aria-hidden="true"><svg viewBox=',
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
		expect(kitScriptsIn(output)).toEqual(["echarts", "charts", "steps", "keep"]);
		const reloaded = await inPage(output, async (cdp) => {
			await act(cdp, `document.getElementById("scenario-burst").click()`, "0");
			await load(cdp);
			return cdp.evaluate(`[${QUEUE_STATE}.controls, document.querySelector(".reply-bar")]`);
		});
		expect(reloaded).toEqual(["burst,1,false", null]);
	}, 30_000);
});

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

/**
 * One use of each kit component, written so it needs every script the component can need (Records: folds and refs), and the kit
 * scripts the page carries when it renders that use itself.
 */
const COMPONENT_USES: Record<string, { use: string; scripts: string[] }> = {
	Chart: {
		use: `<Chart label="Bars" option={{ xAxis: { type: "category", data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] }} />`,
		scripts: ["echarts", "charts"],
	},
	Explore: {
		use: `<Explore label="Bars" controls={[{ id: "n", label: "N", toggle: true }]} frame={(on) => ({ plot: { categories: ["a"], series: [{ type: "bar", data: [on ? 2 : 1] }] } })} />`,
		scripts: ["plot", "keep"],
	},
	Plot: {
		use: `<Plot label="Bars" option={{ categories: ["a"], series: [{ type: "bar", data: [1] }] }} />`,
		scripts: ["plot"],
	},
	Question: {
		use: `<Question name="pick" legend="Pick one" options={["yes", "no"]} />`,
		scripts: ["keep", "reply"],
	},
	Stepper: {
		use: `<Stepper captions={["One", "Two"]}><p data-step="1">One</p><p data-step="2">Two</p></Stepper>`,
		scripts: ["steps"],
	},
	Table: {
		use: `<Table rows={[{ name: "A", n: 1 }]} cols={[{ head: "Name", value: "name" }, { head: "N", value: "n" }]} />`,
		scripts: [],
	},
	Records: {
		use: `<Records id="plan" data={[{ id: "a", phase: "One", note: "Do it" }]} idField="id" fields={{ id: { label: "Task", kind: "text" }, phase: { label: "Phase", kind: "text" }, note: { label: "Note", kind: "text" } }} columns={["id"]} groupBy={["phase"]} detail="note" refField="phase" />`,
		scripts: ["views", "link"],
	},
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
		expect(kitScriptsIn(output)).toContain("reply");
		const kept = await inPage(output, async (cdp) => {
			const reveal = `document.getElementById("reveal").click()`;
			await act(cdp, reveal, "0");
			await act(cdp, `document.getElementById("pick-no").click()`, "0");
			await load(cdp);
			return act(cdp, reveal, `document.getElementById("pick-no").checked`);
		});
		expect(kept).toBe(true);
	}, 30_000);

	test("a self-check a client component renders later, chosen or written beside a model answer, brings keep.js and not reply.js", async () => {
		const scripts = async (name: string, jsx: string) => {
			dir.write(`${name}.tsx`, revealing("Question", jsx));
			const page = `import { Reveal } from "./${name}.tsx";\n\n# Check\n\n<Reveal />\n`;
			return kitScriptsIn(await pack(name, page));
		};
		const unit = `<Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">A kWh is a kW for an hour.</Question>`;
		expect(await scripts("check-later", unit)).toEqual(["keep"]);
		const why = `<Question name="why" legend="Why?"><p>Because.</p></Question>`;
		expect(await scripts("study-later", why)).toEqual(["keep"]);
		// With nothing inside, a written Question joins the reply.
		expect(await scripts("ask-later", `<Question name="why" legend="Why?" />`)).toContain("reply");
	}, 30_000);

	test("a control a client component renders later brings keep.js when it has an id, however its props are written", async () => {
		const later = (props: string) => `"use client";
import { useState } from "preact/hooks";

export function Later({ id }: { id: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button type="button" class="btn" id="reveal" onClick={() => setOpen(true)}>Show</button>
			{open && <input type="range" style={{ inlineSize: "8rem" }} ${props} />}
		</div>
	);
}
`;
		const scripts = async (name: string, props: string) => {
			dir.write(`${name}.tsx`, later(props));
			const page = `import { Later } from "./${name}.tsx";\n\n# Later\n\n<Later id="scale" />\n`;
			return kitScriptsIn(await pack(name, page));
		};
		expect(await scripts("later-id", "id={id}")).toEqual(["keep"]);
		expect(await scripts("later-no-id", 'aria-label="Scale"')).toEqual([]);
	}, 30_000);

	test("two Mermaid diagrams sharing a node id bring link.js, and the parts light together", async () => {
		const fence = (to: string) => `\`\`\`mermaid\nflowchart LR\n  A --> ${to}\n\`\`\`\n`;
		const output = await pack("shared", `# Shared\n\n${fence("B")}\n${fence("C")}`);
		expect(kitScriptsIn(output)).toContain("link");
		const lit = await inPage(output, (cdp) =>
			act(
				cdp,
				`document.querySelector('.mermaid [data-ref="A"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`,
				`[...document.querySelectorAll(".mermaid")].map((d) => d.querySelectorAll('.is-lit[data-ref="A"]').length > 0)`,
			),
		);
		expect(lit).toEqual([true, true]);
	}, 30_000);

	test("every kit component brings its scripts when the page renders it, and at least those when a client component renders it later", async () => {
		const exported = new Bun.Transpiler({ loader: "ts" }).scan(
			readFileSync(new URL("../skills/explainer/kit/components/index.ts", import.meta.url), "utf8"),
		).exports;
		// A View inside a client component fails the pack, so it is the one component without a later use.
		expect([...Object.keys(COMPONENT_USES), "View"].sort()).toEqual(exported.sort());
		const found = await Promise.all(
			Object.entries(COMPONENT_USES).map(async ([name, { use }]) => {
				dir.write(`later-${name}.tsx`, revealing(name, use));
				const [now, later] = await Promise.all([
					pack(`now-${name}`, `import { ${name} } from "kit";\n\n# Now\n\n${use}\n`),
					pack(
						`later-${name}`,
						`import { Reveal } from "./later-${name}.tsx";\n\n# Later\n\n<Reveal />\n`,
					),
				]);
				const [before, after] = [now, later].map(kitScriptsIn);
				const missing = before?.filter((script) => !after?.includes(script));
				return [name, { now: before, missing }] as const;
			}),
		);
		expect(Object.fromEntries(found)).toEqual(
			Object.fromEntries(
				Object.entries(COMPONENT_USES).map(([name, { scripts }]) => [
					name,
					{ now: scripts, missing: [] },
				]),
			),
		);
	}, 60_000);
});
