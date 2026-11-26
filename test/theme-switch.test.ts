import { afterAll, expect, test } from "bun:test";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { withTestPage } from "./browser.ts";
import { inPage, load, packedMdx, scratch, until } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PICKER = ".scheme-picker";
const PICK = (value: string) => `set:${PICKER}=${value}`;
const PAPER = "rgb(247, 244, 238)";
const NIGHT = "rgb(11, 10, 9)";
const READ = `[document.querySelector('${PICKER}')?.value, getComputedStyle(document.body).backgroundColor]`;

async function step(cdp: Cdp, action: string) {
	expect((await runStep(cdp, action, () => dir.path("unused.png"))).problem).toBeUndefined();
}

/** Theme probes use the real native select, and run against the packed file, not a server. */
test("a saved choice overrides the author default before the document's first stylesheet; System follows the OS", async () => {
	const output = await packedMdx(
		dir,
		"choice",
		`---
scheme: dark
labels:
  theme: Appearance
  themeSystem: Device
  themeLight: Day
  themeDark: Night
---

# Reader settings
`,
	);
	await withTestPage(async (cdp) => {
		const url = `file://${output}`;
		const system = (value: string, media = "screen") =>
			cdp.send("Emulation.setEmulatedMedia", {
				media,
				features: [{ name: "prefers-color-scheme", value }],
			});
		await cdp.send("Page.enable");
		await system("light");
		await load(cdp, url);
		expect(await cdp.evaluate(READ)).toEqual(["dark", NIGHT]);
		expect(
			await cdp.evaluate(`(() => {
			const el = document.querySelector('${PICKER}');
			return [el.getAttribute('aria-label'), ...Array.from(el.options, o => o.text)];
		})()`),
		).toEqual(["Appearance", "Device", "Day", "Night"]);
		await step(cdp, "key:Tab");
		expect(
			await cdp.evaluate(`document.activeElement.matches('select${PICKER}:focus-visible')`),
		).toBe(true);
		await step(cdp, PICK("light"));
		expect(await cdp.evaluate(READ)).toEqual(["light", PAPER]);
		await step(cdp, PICK("system"));
		expect(await cdp.evaluate(READ)).toEqual(["system", PAPER]);
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source: `new MutationObserver((_, self) => {
				if (!document.head?.querySelector('style')) return;
				window.schemeAtStylesheet = document.documentElement.getAttribute('data-scheme');
				self.disconnect();
			}).observe(document, { childList: true, subtree: true });`,
		});
		await load(cdp);
		expect(await cdp.evaluate(`[window.schemeAtStylesheet, ...${READ}]`)).toEqual([
			null,
			"system",
			PAPER,
		]);
		await system("dark");
		expect(await cdp.evaluate(READ)).toEqual(["system", NIGHT]);
		await system("dark", "print");
		expect(await cdp.evaluate(`document.querySelector('${PICKER}').checkVisibility()`)).toBe(false);
	});
}, 30_000);

test("switching still works when storage is unavailable", async () => {
	const output = await packedMdx(dir, "no-storage", "# Reader settings\n");
	await withTestPage(async (cdp) => {
		await cdp.send("Page.enable");
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });`,
		});
		await load(cdp, `file://${output}`);
		expect(await cdp.evaluate(`document.querySelector('${PICKER}')?.value`)).toBe("system");
		await step(cdp, PICK("dark"));
		expect(await cdp.evaluate(READ)).toEqual(["dark", NIGHT]);
	});
}, 30_000);

test("the reader theme is shared across files, not restored by Keep or counted among its controls", async () => {
	const a = await packedMdx(
		dir,
		"keep-theme",
		`# Page with Keep

<input name="entry" aria-label="Entry" />
<input id="stable" aria-label="Stable entry" />
`,
	);
	const b = await packedMdx(dir, "other-theme", "# Another page\n");
	await withTestPage(async (cdp) => {
		await cdp.send("Page.enable");
		const pageA = `file://${a}`;
		const state = `[document.querySelector('${PICKER}').value, document.querySelector('[name=entry]').value]`;
		await load(cdp, pageA);
		await step(cdp, "set:input[name=entry]=Reader text");
		await step(cdp, PICK("dark"));
		await load(cdp, `file://${b}`);
		expect(await cdp.evaluate(`document.querySelector('${PICKER}').value`)).toBe("dark");
		await step(cdp, PICK("light"));
		await load(cdp, pageA);
		await load(cdp);
		expect(await cdp.evaluate(state)).toEqual(["light", "Reader text"]);
		expect(
			await cdp.evaluate(
				`Object.keys(JSON.parse(localStorage.getItem('explainer:' + location.href)).controls)`,
			),
		).toEqual(["text@0"]);
	});
}, 30_000);

test("a theme choice in another document of the same origin updates the open picker and page", async () => {
	const output = await packedMdx(dir, "shared-theme", "# Reader settings\n");
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(Bun.file(output)),
	});
	try {
		await withTestPage(async (cdp) => {
			await cdp.send("Page.enable");
			await load(cdp, server.url.href);
			await cdp.evaluate(
				`new Promise((done) => {
				const frame = document.body.appendChild(document.createElement("iframe"));
				frame.onload = done;
				frame.src = "/other";
			})`,
				true,
			);
			await cdp.evaluate(`(() => {
				const picker = document.querySelector("iframe").contentDocument.querySelector("${PICKER}");
				picker.value = "dark";
				picker.dispatchEvent(new Event("change"));
			})()`);
			expect(await until(cdp, `document.querySelector("${PICKER}").value === "dark"`)).toBe(true);
			expect(await cdp.evaluate(READ)).toEqual(["dark", NIGHT]);
		});
	} finally {
		await server.stop(true);
	}
}, 30_000);

test("switching updates the existing SVG drawings, scans and code in place", async () => {
	const scan = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
	const output = await packedMdx(
		dir,
		"theme-art",
		`import { Plot } from "kit";

# Theme art

<Plot label="Output" option={{ series: [{ data: [[0, 0], [1, 2]], color: "var(--accent)" }] }} />

\`\`\`mermaid
flowchart LR
  A[Input] --> B[Output]
\`\`\`

\`\`\`schematic
R1 nc nc 1k @0,0
\`\`\`

![Themed SVG](figure.svg)

<img class="ink" alt="Ink scan" src="${scan}" />
<img class="paper" alt="Paper scan" src="${scan}" />

\`\`\`ts
const answer = 42;
\`\`\`
`,
		{
			"figure.svg":
				'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="currentColor"/></svg>',
		},
	);
	await inPage(output, async (cdp) => {
		const state = `(() => {
			const css = (selector) => getComputedStyle(document.querySelector(selector));
			return {
				plot: css('.plot svg path.line').stroke,
				mermaid: css('.mermaid svg text').fill,
				schematic: css('.schematic svg').color,
				code: css('.tok-keyword').color,
				image: css('img.light').display === 'none' && css('img.dark').display !== 'none',
				ink: css('img.ink').mixBlendMode,
				paper: css('img.paper').filter,
			};
		})()`;
		await step(cdp, PICK("light"));
		const light = await cdp.evaluate<Record<string, string | boolean>>(state);
		await step(cdp, PICK("dark"));
		const dark = await cdp.evaluate<typeof light>(state);
		expect(dark).toMatchObject({ plot: "rgb(255, 138, 61)", image: true, ink: "screen" });
		expect(light).toMatchObject({ plot: "rgb(185, 58, 5)", image: false, ink: "multiply" });
		for (const key of ["mermaid", "schematic", "code", "paper"]) {
			expect(dark[key]).not.toBe(light[key]);
		}
	});
}, 30_000);

test("live Chart resolves new colours without losing legend or zoom state, even with the same page ink", async () => {
	const output = await packedMdx(
		dir,
		"chart",
		`import "./same-ink.css";
import { Chart } from "kit";

# Chart colours

<Chart id="demo" label="Theme chart" option={{
  legend: {}, dataZoom: [{ type: "inside" }],
  xAxis: { type: "category", data: ["a", "b", "c", "d", "e"] }, yAxis: {},
  series: [{ name: "Bars", type: "bar", data: [1, 2, 3, 2, 1], itemStyle: { color: "var(--accent)" } }],
}} />
`,
		{ "same-ink.css": ":root { --ink: #555; }" },
	);
	await inPage(output, async (cdp) => {
		const chart = `echarts.getInstanceByDom(document.getElementById('demo'))`;
		const state = `(() => {
			const { series, legend, dataZoom } = ${chart}.getOption();
			return [series[0].itemStyle.color, legend[0].selected.Bars, dataZoom[0].start, dataZoom[0].end];
		})()`;
		await step(cdp, PICK("light"));
		await cdp.evaluate(`(() => {
			const chart = ${chart};
			chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 });
			chart.dispatchAction({ type: 'legendUnSelect', name: 'Bars' });
		})()`);
		expect(await cdp.evaluate(state)).toEqual(["rgb(185, 58, 5)", false, 25, 75]);
		await step(cdp, PICK("dark"));
		expect(await cdp.evaluate(state)).toEqual(["rgb(255, 138, 61)", false, 25, 75]);
		await cdp.evaluate(`document.getElementById('demo').hidden = true`);
		await step(cdp, PICK("light"));
		await cdp.evaluate(`document.getElementById('demo').hidden = false`);
		expect(await until(cdp, chart)).toBe(true);
		expect(await cdp.evaluate(state)).toEqual(["rgb(185, 58, 5)", false, 25, 75]);
	});
}, 30_000);
