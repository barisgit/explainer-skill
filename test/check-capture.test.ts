import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { fullPageScreenshot } from "../skills/explainer/src/full-page.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const fixture = join(import.meta.dir, "fixtures/check-fullpage.html");

interface Stripe {
	first: number;
	last: number;
	count: number;
}
interface Pixels {
	width: number;
	height: number;
	colours: Record<
		"header" | "footer" | "fixed" | "open" | "tab" | "chart" | "panel" | "inner" | "scoped",
		Stripe
	>;
}

/** Reads solid-colour stripes from the actual PNG, away from text and native control decoration. */
async function pixels(files: string[]): Promise<Pixels[]> {
	return withPage(async (cdp) => {
		const images = files.map((file) => readFileSync(file).toString("base64"));
		return cdp.evaluate<Pixels[]>(
			`(async () => {
			const results = [];
			for (const data of ${JSON.stringify(images)}) {
				const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
				const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
				const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
				const colours = {};
				const samples = { header: [250, '0,128,0'], footer: [250, '255,128,0'], fixed: [img.width - 2, '255,0,0'],
					open: [90, '0,0,255'], tab: [90, '0,255,0'], chart: [90, '255,0,255'], panel: [190, '0,255,255'], inner: [190, '128,128,0'], scoped: [90, '128,128,255'] };
				for (const [key, [x, rgb]] of Object.entries(samples)) {
					const column = ctx.getImageData(Math.min(x, img.width - 1), 0, 1, img.height).data;
					const hits = [];
					for (let y = 0; y < img.height; y++) if ([...column.slice(y * 4, y * 4 + 3)].join() === rgb) hits.push(y);
					colours[key] = { first: hits[0] ?? -1, last: hits.at(-1) ?? -1, count: hits.length };
				}
				results.push({ width: img.width, height: img.height, colours });
			}
			return results;
		})()`,
			true,
		);
	});
}

test("full-page shots keep the sticky footer in flow and preserve the scrolling interaction state", async () => {
	const out = dir.path("shots");
	const result = await runCli([
		"check",
		fixture,
		"--view",
		"none",
		"--out",
		out,
		"--do",
		"click:#change",
		"--do",
		"shot:#fixed",
	]);
	expect(result.code).toBe(0);
	for (const theme of ["light", "dark"]) {
		for (const screen of ["desktop", "narrow"]) {
			const [full, first, fixed] = await pixels([
				join(out, `check-fullpage-${theme}-${screen}.png`),
				join(out, `check-fullpage-first-${theme}-${screen}.png`),
				join(out, `check-fullpage-shot1-fixed-${theme}-${screen}.png`),
			]);
			expect(full?.colours.footer).toEqual({
				first: (full?.height ?? 0) - 40,
				last: (full?.height ?? 0) - 1,
				count: 40,
			});
			expect(full?.colours.header).toEqual({ first: 0, last: 39, count: 40 });
			expect(full?.colours.fixed?.count).toBe(0);
			expect(full?.colours.open?.count).toBe(60);
			expect(full?.colours.tab?.count).toBe(20);
			expect(full?.colours.chart?.count).toBe(60);
			expect(full?.colours.panel?.count).toBe(80);
			expect(first?.colours.fixed?.count).toBe(30);
			expect(fixed?.width).toBe(30);
			expect(fixed?.height).toBe(30);
			expect(fixed?.colours.fixed?.count).toBe(30);
		}
	}
}, 30_000);

test("full-page capture restores styles without scrolling, resizing or changing native, canvas and inner-scroll state", async () => {
	const output = dir.path("preserved.png");
	await withPage(async (cdp) => {
		await cdp.send("Page.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 390,
			height: 844,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.load(`file://${fixture}`);
		await runStep(cdp, "click:#change", () => "unused");
		await cdp.evaluate(`
			document.querySelector('header').style.cssText = 'top: 0 !important; transition: top 1s;';
			document.getElementById('fixed').style.opacity = '0.8';
			const panel = document.getElementById('panel');
			panel.style.height = '10vh';
			panel.insertAdjacentHTML('afterbegin', '<div id="inner-sticky" style="position:sticky;top:0;height:20px;background:rgb(128,128,0)">Panel header</div>');
			panel.scrollTop = 180;
			document.body.insertAdjacentHTML('beforeend', '<div style="transform:translateZ(0);height:40px"><span id="scoped-fixed" style="position:fixed;top:0;width:100px;height:20px;background:rgb(128,128,255)">Scoped</span></div>');
		`);
		await cdp.evaluate(
			`new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))`,
			true,
		);
		await cdp.evaluate(`window.captureEvents = [];
			addEventListener('scroll', () => window.captureEvents.push('scroll'));
			addEventListener('resize', () => {
				window.captureEvents.push('resize');
				document.getElementById('panel').scrollTop = 0;
			});`);
		const state = `({
			open: document.getElementById('details').open,
			tab: document.getElementById('tab').value,
			chart: document.getElementById('chart').toDataURL(),
			panel: document.getElementById('panel').scrollTop,
			scrollY, innerHeight, events: window.captureEvents,
			styles: [...document.querySelectorAll('header, footer, #fixed')].map(el => el.getAttribute('style')),
			innerSticky: document.getElementById('inner-sticky').getBoundingClientRect().top,
			scopedFixed: getComputedStyle(document.getElementById('scoped-fixed')).opacity,
		})`;
		const before = await cdp.evaluate(state);
		const png = await fullPageScreenshot(cdp, 390);
		writeFileSync(output, Buffer.from(png, "base64"));
		expect(Buffer.from(png, "base64").readUInt32BE(16)).toBe(390);
		await cdp.evaluate(
			`new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))`,
			true,
		);
		expect(await cdp.evaluate(state)).toEqual(before);
	});
	const [captured] = await pixels([output]);
	expect(captured?.colours.inner.count).toBe(20);
	expect(captured?.colours.scoped.count).toBe(20);
}, 30_000);

test.each([false, true])(
	"pending one-shot timers and rAF chains survive capture (failure=%p)",
	async (fails) => {
		await withPage(async (cdp) => {
			await cdp.send("Page.enable");
			await cdp.load(`file://${fixture}`);
			const send = cdp.send.bind(cdp);
			cdp.send = async <T>(method: string, params?: object, deadline?: number): Promise<T> => {
				if (method === "Page.captureScreenshot") {
					await cdp.evaluate(`window.once = false; window.frames = 0;
						setTimeout(() => window.once = true, 20);
						window.frameId = requestAnimationFrame(function frame() {
							window.frames++; window.frameId = requestAnimationFrame(frame);
						});`);
					await Bun.sleep(100);
					if (fails) {
						throw new Error("capture failed");
					}
				}
				return send<T>(method, params, deadline);
			};
			try {
				if (fails) {
					await expect(fullPageScreenshot(cdp, 390)).rejects.toThrow("capture failed");
				} else {
					await fullPageScreenshot(cdp, 390);
				}
			} finally {
				cdp.send = send;
			}
			const frames = await cdp.evaluate<number>("window.frames");
			await cdp.evaluate("new Promise(done => setTimeout(done, 50))", true);
			expect({
				once: await cdp.evaluate("window.once"),
				chain: (await cdp.evaluate<number>("window.frames")) > frames,
			}).toEqual({ once: true, chain: true });
			await cdp.evaluate("cancelAnimationFrame(window.frameId)");
		});
	},
	30_000,
);

test("restoring an omitted overlay does not restart its important opacity transition", async () => {
	await withPage(async (cdp) => {
		await cdp.send("Page.enable");
		await cdp.load(
			`file://${dir.write(
				"transition.html",
				`<!doctype html><meta name="viewport" content="width=device-width"><style>
			body { height:1800px } #overlay { position:fixed;top:0;opacity:0.7;transition:opacity 1s!important }
			</style><div id="overlay" style="color:red">Overlay</div>`,
			)}`,
		);
		const state = `({ opacity: getComputedStyle(document.getElementById('overlay')).opacity,
			style: document.getElementById('overlay').getAttribute('style') })`;
		const before = await cdp.evaluate(state);
		await fullPageScreenshot(cdp, 390);
		expect(await cdp.evaluate(state)).toEqual(before);
	});
}, 30_000);

test("a failed full-page capture restores styles and page callbacks", async () => {
	await withPage(async (cdp) => {
		await cdp.send("Page.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 390,
			height: 844,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.load(`file://${fixture}`);
		const styles = `['header','footer','#fixed'].map(selector => document.querySelector(selector).getAttribute('style'))`;
		const before = await cdp.evaluate(styles);
		const send = cdp.send.bind(cdp);
		// A screenshot protocol error must not strand the live page with callbacks disabled or capture-only CSS.
		cdp.send = <T>(method: string, params?: object, deadline?: number): Promise<T> =>
			method === "Page.captureScreenshot"
				? Promise.reject(new Error("capture failed"))
				: send<T>(method, params, deadline);
		try {
			await expect(fullPageScreenshot(cdp, 390)).rejects.toThrow("capture failed");
		} finally {
			cdp.send = send;
		}
		expect(await cdp.evaluate(styles)).toEqual(before);
		await runStep(cdp, "click:#change", () => "unused");
		expect(await cdp.evaluate("document.getElementById('details').open")).toBe(true);
	});
}, 30_000);
