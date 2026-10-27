import { afterAll, expect, test } from "bun:test";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { TIMERS_JS } from "../skills/explainer/src/page-js.ts";
import { settlePage } from "../skills/explainer/src/steps.ts";
import { scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/**
 * Opens a page made of `script` as check does (TIMERS_JS in every document), waits as check does after a load (settlePage), and
 * returns what the wait reported missing ("" when the page settled) with the page's `state` expression right after it.
 */
function settled<T>(name: string, script: string, state: string) {
	const file = dir.write(
		name,
		`<!doctype html><html><body><script>${script}</script></body></html>`,
	);
	return withPage(async (cdp) => {
		await cdp.send("Page.enable");
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TIMERS_JS });
		await cdp.load(`file://${file}`);
		const missing = await settlePage(cdp);
		return { missing, state: await cdp.evaluate<T>(state, true) };
	});
}

test("the wait rechecks the charts after the page's short timers, so a chart a timer adds is drawn before it ends", async () => {
	// A stand-in for ECharts: a chart counts as drawn once it has data-drawn. The 300 ms timer adds a chart that is drawn 1.5 s
	// later, past any timer the wait tracks, so only the recheck after the timers makes the wait cover it. The timer the page
	// re-arms every 100 ms must not keep the wait from ending.
	const { missing, state } = await settled<string | undefined>(
		"timer-chart.html",
		`window.echarts = { getInstanceByDom: (el) => (el.dataset.drawn ? {} : undefined) };
setTimeout(() => {
	const chart = Object.assign(document.createElement("div"), { className: "chart" });
	document.body.append(chart);
	setTimeout(() => { chart.dataset.drawn = "yes"; }, 1500);
}, 300);
const tick = () => setTimeout(tick, 100);
tick();`,
		`document.querySelector(".chart")?.dataset.drawn`,
	);
	expect(missing).toBe("");
	expect(state).toBe("yes");
}, 30_000);

test("a timeout cancelled by clearInterval counts as cancelled, as it does natively", async () => {
	const { missing, state } = await settled<boolean>(
		"cross-cancel.html",
		`window.fired = false;
clearInterval(setTimeout(() => { window.fired = true; }, 500));`,
		`new Promise((done) => setTimeout(() => done(window.fired), 700))`,
	);
	expect(missing).toBe("");
	expect(state).toBe(false);
}, 30_000);
