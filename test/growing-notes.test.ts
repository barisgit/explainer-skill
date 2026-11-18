import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { withTestPage } from "./browser.ts";
import { load, packedMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const PAGE = `---
title: Growing notes
reply: true
---
import { Question } from "kit";

# Growing notes

<Question name="choice" legend="Which stack?" options={["One", "Two"]} note />
<Question name="rows" legend="Which size?" rows={[{ size: "Small" }, { size: "Large" }]} cols={[{ head: "Size", value: "size" }]} note />
<Question name="written" legend="Explain your answer" />
<p><span data-ref="claim" id="claim">A claim to annotate</span></p>
`;
const TEXT = `A sentence that needs more than one line on a narrow screen, so none of it should be cut off.\nSecond line with ${"longword".repeat(18)}.`;
const LONG = Array.from({ length: 35 }, (_, i) => `Line ${i}: ${TEXT}`).join("\n");

/** Wait for native layout or the fallback's observers, without depending on its implementation. */
const FRAMES = "new Promise(requestAnimationFrame).then(() => new Promise(requestAnimationFrame))";

async function type(cdp: Cdp, selector: string, text: string) {
	await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
	await cdp.send("Input.insertText", { text });
	await cdp.evaluate(FRAMES, true);
}

/** Inspect actual textarea content boxes, including overflow rather than only the outer height. */
async function geometry(cdp: Cdp, selector: string) {
	return cdp.evaluate<{
		height: number;
		full: boolean;
		width: number;
		parentWidth: number;
		value: string;
	}>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		const box = el.getBoundingClientRect();
		return { height: box.height, full: el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
			width: box.width, parentWidth: el.parentElement.getBoundingClientRect().width, value: el.value };
	})()`);
}

async function shot(cdp: Cdp, name: string) {
	const { NOTE_SHOTS: folder } = process.env;
	if (folder) {
		mkdirSync(folder, { recursive: true });
		const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
		});
		await Bun.write(join(folder, `${name}.png`), Buffer.from(data, "base64"));
	}
}

/** Emulate a browser without field-sizing; native CSS must also be disabled, not just feature detection. */
const FALLBACK = `const supports = CSS.supports.bind(CSS);
CSS.supports = (property, value) => property === 'field-sizing' ? false : supports(property, value);
document.addEventListener('DOMContentLoaded', () => {
	const style = document.createElement('style'); style.textContent = 'textarea { field-sizing: fixed !important; }'; document.head.append(style);
});`;

async function exercise(cdp: Cdp, path: string, label: string) {
	await cdp.load("about:blank");
	await cdp.send("Storage.clearDataForOrigin", {
		origin: "file://",
		storageTypes: "local_storage",
	});
	await load(cdp, `file://${path}`);
	for (const selector of ['[id="choice.note"]', '[id="rows.note"]', "#written"]) {
		expect(await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).tagName`)).toBe(
			"TEXTAREA",
		);
		const initial = await geometry(cdp, selector);
		expect(initial.height).toBeLessThan(50);
		expect(initial.width).toBeGreaterThan(initial.parentWidth - 4);
		await type(cdp, selector, TEXT);
		const grown = await geometry(cdp, selector);
		expect(grown.value).toBe(TEXT);
		expect(grown.height).toBeGreaterThan(initial.height);
		expect(grown.full).toBe(true);
	}
	// Native Enter inserts a line rather than submitting or discarding it.
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		text: "\r",
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await cdp.send("Input.insertText", { text: "After Enter" });
	expect((await geometry(cdp, "#written")).value).toBe(`${TEXT}\nAfter Enter`);
	await load(cdp);
	for (const selector of ['[id="choice.note"]', '[id="rows.note"]', "#written"]) {
		const restored = await geometry(cdp, selector);
		expect(restored.full).toBe(true);
		expect(restored.height).toBeGreaterThan(50);
	}
	const markdown = await cdp.evaluate<string>("ReplyNotes.markdown()");
	expect(markdown).toContain(`Note: ${TEXT.split("\n").join("\n  ")}`);
	expect(markdown).toContain(
		`- Explain your answer: ${TEXT.split("\n").join("\n  ")}\n  After Enter`,
	);
	await shot(cdp, `${label}-restored`);
	await type(cdp, '[id="choice.note"]', LONG);
	const capped = await geometry(cdp, '[id="choice.note"]');
	expect(capped.height).toBeLessThan(400);
	expect(capped.full).toBe(false);
	await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
	await cdp.evaluate("dispatchEvent(new Event('beforeprint'))");
	await cdp.evaluate(FRAMES, true);
	expect(
		await cdp.evaluate(
			"document.querySelector('[id=\"choice.note\"] + [data-grow-print]').textContent",
		),
	).toContain(LONG);
	const { NOTE_SHOTS: folder } = process.env;
	if (folder) {
		const { data } = await cdp.send<{ data: string }>("Page.printToPDF", { printBackground: true });
		await Bun.write(join(folder, `${label}-print.pdf`), Buffer.from(data, "base64"));
	}
	await cdp.send("Emulation.setEmulatedMedia", { media: "screen" });
	await cdp.evaluate("dispatchEvent(new Event('afterprint'))");
	await cdp.evaluate(
		"document.querySelector('#claim').scrollIntoView(); document.querySelector('#claim').click(); document.querySelector('.reply-hint').click()",
	);
	const initial = await geometry(cdp, ".reply-pop textarea");
	await type(cdp, ".reply-pop textarea", TEXT);
	const editor = await geometry(cdp, ".reply-pop textarea");
	expect(editor.height).toBeGreaterThan(initial.height);
	expect(editor.full).toBe(true);
	await shot(cdp, `${label}-editor`);
	expect(
		await cdp.evaluate(
			"document.querySelector('.reply-pop').getBoundingClientRect().bottom <= innerHeight - 7",
		),
	).toBe(true);
}

for (const fallback of [false, true]) {
	test(`notes grow, restore, preserve line breaks and print fully (${fallback ? "fallback" : "native"})`, async () => {
		const path = await packedMdx(dir, `growing-${fallback}`, PAGE);
		await withTestPage(async (cdp) => {
			await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
			if (fallback) {
				await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FALLBACK });
			}
			for (const viewport of WIDTHS) {
				await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
				await exercise(cdp, path, `${viewport.width}-${fallback ? "fallback" : "native"}`);
			}
		});
	}, 60_000);
}

test("notes saved by the previous text-input export restore into the growing textarea", async () => {
	const path = await packedMdx(dir, "legacy-note", PAGE);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}`);
		await cdp.evaluate(`(() => {
			const field = document.querySelector('[id="choice.note"]');
			const old = document.createElement('input');
			for (const { name, value } of field.attributes) old.setAttribute(name, value);
			old.type = 'text';
			field.replaceWith(old);
			old.value = ${JSON.stringify(TEXT)}.replaceAll('\\n', ' ');
			old.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
		await load(cdp);
		const restored = await geometry(cdp, '[id="choice.note"]');
		expect(restored.value).toBe(TEXT.replaceAll("\n", " "));
		expect(restored.full).toBe(true);
	});
}, 30_000);

test("a long Records note prints fully when printing remounts a table or board as the whole tree", async () => {
	const path = await packedMdx(
		dir,
		"records-print",
		`import { Records } from "kit";

# Review

<Records id="plans" idField="id" data={[{ id: "a", title: "First plan" }]} fields={{ id: { label: "ID", kind: "text" }, title: { label: "Title", kind: "text" } }} columns={["title"]} groupBy={["id"]} views={["tree", "table", "board"]} reply={{ options: ["Agree", "Change"], note: true }} />
`,
	);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}`);
		await cdp.evaluate(
			"document.querySelectorAll('#plans details').forEach(el => { el.open = true; })",
		);
		await cdp.evaluate(FRAMES, true);
		await type(cdp, "#plans textarea[data-note]", LONG);
		for (const n of [2, 3]) {
			await cdp.evaluate(
				`document.querySelector('#plans .toolbar .seg label:nth-child(${n}) input').click()`,
			);
			await cdp.evaluate(FRAMES, true);
			expect((await geometry(cdp, "#plans textarea[data-note]")).value === LONG).toBe(true);
			await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
			await cdp.evaluate("dispatchEvent(new Event('beforeprint'))");
			await cdp.evaluate(FRAMES, true);
			expect(
				await cdp.evaluate(
					"document.querySelector('#plans textarea[data-note] + [data-grow-print]')?.textContent",
				),
			).toBe(LONG);
			await cdp.send("Emulation.setEmulatedMedia", { media: "screen" });
			await cdp.evaluate("dispatchEvent(new Event('afterprint'))");
			await cdp.evaluate(FRAMES, true);
			expect((await geometry(cdp, "#plans textarea[data-note]")).value).toBe(LONG);
			expect(
				await cdp.evaluate(
					`document.querySelector('#plans .toolbar .seg label:nth-child(${n}) input').checked`,
				),
			).toBe(true);
		}
	});
}, 30_000);

test("the fallback releases removed textareas even when hidden before removal", async () => {
	const path = await packedMdx(dir, "hidden-notes", PAGE);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source: `${FALLBACK}
		window.resizeTargets = new Set();
		const Original = ResizeObserver;
		window.ResizeObserver = class extends Original {
			observe(target, options) { resizeTargets.add(target); super.observe(target, options); }
			unobserve(target) { resizeTargets.delete(target); super.unobserve(target); }
		};`,
		});
		await load(cdp, `file://${path}`);
		for (let n = 0; n < 3; n++) {
			await cdp.evaluate(
				`window.detached = document.createElement('textarea'); detached.dataset.grow = ''; detached.hidden = true; document.body.append(detached)`,
			);
			await cdp.evaluate(FRAMES, true);
			expect(await cdp.evaluate("resizeTargets.has(detached)")).toBe(true);
			await cdp.evaluate("detached.remove()");
			await cdp.evaluate(FRAMES, true);
			expect(await cdp.evaluate("resizeTargets.has(detached)")).toBe(false);
		}
	});
}, 30_000);
