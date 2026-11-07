import { afterAll, expect, test } from "bun:test";
import type { Shot } from "../skills/explainer/src/check.ts";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { SWEEP_JS, SWEEP_WARNING } from "../skills/explainer/src/page-probes.ts";
import { report } from "../skills/explainer/src/report.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const page = (body: string, script = "") =>
	`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body>${body}<script>${script}</script>`;

test("check catches errors from vertical and horizontal inner scrollers", async () => {
	const file = dir.write(
		"inner.html",
		page(
			`<div id="vertical" style="overflow:auto;height:100px;width:100px"><div style="height:300px">Tall</div><div id="sentinel">End</div></div>
<div id="horizontal" style="overflow:scroll;height:100px;width:100px;direction:rtl"><div style="width:300px">Wide</div></div>
<div id="matrix" style="overflow:auto;height:100px;width:100px"><div style="width:300px;height:300px;position:relative"><span id="corner" style="position:absolute;left:280px;top:0">Corner</span></div></div>
<details><summary>Closed</summary><div id="closed" style="overflow:auto;height:100px"><div style="height:300px">Hidden</div></div></details>`,
			`for (const id of ["vertical", "horizontal", "closed"]) {
	const el = document.getElementById(id);
	el.addEventListener("scroll", () => { if (el.scrollTop || el.scrollLeft) console.error("scrolled " + id); });
}
new IntersectionObserver(entries => {
	if (entries.some(e => e.isIntersecting)) console.error("inner observer");
}, { root: document.getElementById("vertical") }).observe(document.getElementById("sentinel"));
new IntersectionObserver(entries => {
	if (entries.some(e => e.isIntersecting)) console.error("off-diagonal observer");
}, { root: document.getElementById("matrix") }).observe(document.getElementById("corner"));`,
		),
	);
	const result = await runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("inner-shots"),
	]);
	expect(result.code).toBe(1);
	expect(result.stdout).toContain("console.error: scrolled vertical");
	expect(result.stdout).toContain("console.error: scrolled horizontal");
	expect(result.stdout).not.toContain("console.error: scrolled closed");
	expect(result.stdout).toContain("console.error: inner observer");
	expect(result.stdout).toContain("console.error: off-diagonal observer");
}, 30_000);

test("check reports budget exhaustion once across screens, naming the unreached document", async () => {
	const file = dir.write(
		"budget.html",
		page(
			'<div style="height:6000px">Long</div>',
			`const now = performance.now.bind(performance);
let elapsed = 0;
performance.now = () => now() + elapsed;
addEventListener("scroll", () => { if (scrollY) elapsed += 4000; });`,
		),
	);
	const result = await runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("budget-shots"),
	]);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain("scroll sweep incomplete after 3 s (overview)");
	expect(result.stdout).toContain("document not reached: scroll the rest by hand");
	expect(result.stdout.match(/scroll sweep incomplete/g)).toHaveLength(1);
	expect(result.stdout).toContain("Verdict: ok, 0 problems, 1 warning.");
}, 30_000);

test("incomplete sweeps group differing screen details once per overview or view", () => {
	const shot = (viewport: string, view: string, detail: string): Shot => ({
		theme: "light",
		viewport,
		view,
		png: "shot.png",
		elements: [],
		problems: [],
		warnings: [`${SWEEP_WARNING}: ${detail}: scroll the rest by hand`],
	});
	const text = report(
		"shots",
		[
			shot("desktop 1440x900", "", "document not reached"),
			shot("narrow 390x844", "", "2 inner scroller(s) not reached (div#one, div#two)"),
			shot("desktop 1440x900", "#detail/a", "document not reached"),
			shot("narrow 390x844", "#detail/a", "1 inner scroller(s) not reached (div#one)"),
		],
		{ found: [], captured: [], uncaptured: [], templates: [] },
		[],
	);
	expect(text.match(/scroll sweep incomplete/g)).toHaveLength(2);
	expect(text).toContain("document not reached");
	expect(text).toContain("2 inner scroller(s) not reached");
	expect(text).toContain("light narrow #detail/a");
	expect(text).toContain("Verdict: ok, 0 problems, 2 warnings.");
});

test("the document and inner scrollers share one budget and restore their positions", async () => {
	await withPage(async (cdp) => {
		await cdp.send("Page.enable");
		await cdp.load(
			`file://${dir.write(
				"shared.html",
				page(
					'<div style="height:6000px">Long</div>' +
						Array.from(
							{ length: 8 },
							(_, i) =>
								`<div id="panel${i}" style="height:100px;overflow:auto"><div style="height:1000px">Tall</div></div>`,
						).join(""),
				),
			)}`,
		);
		// Advance only the sweep's clock at its first document scroll, avoiding a huge fixture or a 3 s wait.
		await cdp.evaluate(`window.originalNow = performance.now.bind(performance);
			let elapsed = 0;
			performance.now = () => window.originalNow() + elapsed;
			addEventListener('scroll', () => { elapsed += 4000; }, { once: true });`);
		const started = performance.now();
		const warnings = await cdp.evaluate<string[]>(SWEEP_JS, true);
		expect(performance.now() - started).toBeLessThan(1000);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("document not reached");
		expect(warnings[0]).toContain("8 inner scroller(s) not reached");
		expect(
			await cdp.evaluate(
				"scrollY + [...document.querySelectorAll('div[id]')].reduce((sum, el) => sum + el.scrollTop, 0)",
			),
		).toBe(0);
		await cdp.evaluate(`performance.now = window.originalNow;
			document.querySelector('div').style.height = '100px';
			for (const panel of document.querySelectorAll('div[id]')) panel.firstElementChild.style.height = '200px';
			document.getElementById('panel0').scrollTop = 40;
		`);
		expect(await cdp.evaluate<string[]>(SWEEP_JS, true)).toEqual([]);
		expect(await cdp.evaluate("document.getElementById('panel0').scrollTop")).toBe(40);
		expect(await cdp.evaluate("scrollY")).toBe(0);
	});
}, 30_000);
