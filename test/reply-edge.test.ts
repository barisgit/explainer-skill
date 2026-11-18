import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { withTestPage } from "./browser.ts";
import { load, packedMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const TARGET = `<div style={{ height: "120vh" }} /><p id="edge" style={{ textAlign: "right" }}><span data-ref="edge">Final right-edge note target</span></p><div style={{ height: "120vh" }} />`;
const source = (layout: string) => `---
title: Bottom-edge notes
reply: true
---
import { View } from "kit";

# Bottom-edge notes

${layout === "view" ? `<View name="detail" title="Detail">${TARGET}</View>` : layout === "beside" ? `<div class="beside"><div>${TARGET}</div><figure aria-label="A companion figure"><svg viewBox="0 0 200 100" role="img" aria-label="Companion"><rect x="10" y="10" width="180" height="80" fill="none" stroke="currentColor" /></svg></figure></div>` : TARGET}
`;

/** Reproduce the hunter's bottom-edge pointer and keyboard openings, without allowing focus to scroll away from the edge. */
async function open(cdp: Cdp, keyboard: boolean, block = "end") {
	const point = await cdp.evaluate<{ x: number; y: number }>(`(() => {
		document.querySelector('.reply-pop .btn')?.click();
		const part = document.querySelector('#edge span');
		part.scrollIntoView({ block: ${JSON.stringify(block)} });
		part.focus({ preventScroll: true });
		const box = part.getBoundingClientRect();
		return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	})()`);
	if (keyboard) {
		for (const type of ["keyDown", "keyUp"]) {
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "Enter",
				code: "Enter",
				windowsVirtualKeyCode: 13,
			});
		}
	} else {
		for (const type of ["mousePressed", "mouseReleased"]) {
			await cdp.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
		}
		expect(await cdp.evaluate(`(${VISIBLE})('.reply-hint')`)).toBe(true);
		await cdp.evaluate("document.querySelector('.reply-hint').click()");
	}
	await cdp.evaluate(
		"new Promise(requestAnimationFrame).then(() => new Promise(requestAnimationFrame))",
		true,
	);
}

const VISIBLE = `(selector) => {
	const box = document.querySelector(selector).getBoundingClientRect();
	const column = document.querySelector('main').getBoundingClientRect();
	return box.top >= 7 && box.bottom <= innerHeight - 7 && box.left >= Math.max(8, column.left) - 1 && box.right <= Math.min(innerWidth - 8, column.right) + 1;
}`;

/** Optional screenshots preserve each distinct short-viewport opening. */
async function shot(
	cdp: Cdp,
	layout: string,
	viewport: { width: number; height: number },
	scheme: string,
	keyboard: boolean,
) {
	const { NOTE_SHOTS: folder } = process.env;
	if (!folder) {
		return;
	}
	mkdirSync(folder, { recursive: true });
	const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const name = `${layout}-${viewport.width}x${viewport.height}-${scheme}-${keyboard ? "keyboard" : "pointer"}.png`;
	await Bun.write(join(folder, name), Buffer.from(data, "base64"));
}

for (const layout of ["plain", "beside", "view"]) {
	test(`bottom-edge note hints and editors stay fully on-screen in ${layout} pages, including a short phone viewport`, async () => {
		const path = await packedMdx(dir, `edge-${layout}`, source(layout));
		await withTestPage(async (cdp) => {
			await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
			for (const viewport of [...WIDTHS, { width: 390, height: 400, mobile: true }]) {
				await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
				for (const scheme of ["light", "dark"]) {
					await cdp.send("Emulation.setEmulatedMedia", {
						features: [{ name: "prefers-color-scheme", value: scheme }],
					});
					await load(cdp, `file://${path}${layout === "view" ? "#detail" : ""}`);
					for (const keyboard of [true, false]) {
						await open(cdp, keyboard);
						expect(await cdp.evaluate(`(${VISIBLE})('.reply-pop')`)).toBe(true);
						await shot(cdp, layout, viewport, scheme, keyboard);
					}
				}
			}
		});
	}, 60_000);
}

for (const keyboard of [true, false]) {
	test(`a growing editor scrolls the minimum needed when neither vertical slot initially fits (${keyboard ? "keyboard" : "pointer"})`, async () => {
		const path = await packedMdx(dir, "edge-middle", source("plain"));
		await withTestPage(async (cdp) => {
			await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: 390,
				height: 400,
				mobile: true,
				deviceScaleFactor: 1,
			});
			await load(cdp, `file://${path}`);
			await open(cdp, keyboard, "center");
			const before = await cdp.evaluate<{ scroll: number; top: number; bottom: number }>(
				"(() => { const box = document.querySelector('#edge span').getBoundingClientRect(); return { scroll: scrollY, top: box.top, bottom: box.bottom }; })()",
			);
			await cdp.send("Input.insertText", {
				text: "A long note that needs room to show what the reader has written. ".repeat(12),
			});
			await cdp.evaluate(
				"new Promise(requestAnimationFrame).then(() => new Promise(requestAnimationFrame)).then(() => new Promise(requestAnimationFrame))",
				true,
			);
			const seen = await cdp.evaluate<{ clear: boolean; moved: number; height: number }>(`(() => {
			const box = document.querySelector('.reply-pop').getBoundingClientRect(), target = document.querySelector('#edge span').getBoundingClientRect();
			return { clear: box.bottom <= target.top - 5 || box.top >= target.bottom + 5, moved: Math.abs(scrollY - ${before.scroll}), height: box.height };
		})()`);
			expect(seen.clear).toBe(true);
			expect(seen.moved).toBeCloseTo(
				Math.min(seen.height + 14 - before.top, before.bottom + seen.height + 14 - 400),
				0,
			);
			expect(await cdp.evaluate(`(${VISIBLE})('.reply-pop')`)).toBe(true);
		});
	}, 30_000);
}
