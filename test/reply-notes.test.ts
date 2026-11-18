import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { withTestPage } from "./browser.ts";
import { load, packedMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PAGE = `---
title: Selection notes
reply: true
---

# Selection notes

Select a passage to send feedback.

<div style={{ height: "100vh" }} />

<p id="passage">A selected paragraph explains how the pieces fit together, with enough words to wrap across several lines on a phone.</p>
<h3>What each stack has</h3>
<p>The next line must remain readable while the reader adds a note.</p>
<p id="right" style={{ textAlign: "right" }}>A selection at the right edge.</p>
<p>The <span id="term" data-ref="input">input</span> reaches the processor. A longer explanation continues through several sentences to hold a figure beside the argument.</p>
<div data-ref="input">Input partner</div>

| Item | Explanation |
| --- | --- |
| Stack | <span id="cell">A passage inside a table cell.</span> |

\`\`\`text
A passage inside a code fence.
\`\`\`

<div style={{ height: "100vh" }} />
`;

/** Select real rendered text; resolve when the kit's debounced selection listener has drawn its hint. */
async function select(cdp: Cdp, selector: string, edge: string) {
	await cdp.evaluate(
		`(() => {
		document.querySelector('.reply-pop .btn')?.click();
		getSelection().removeAllRanges();
		const element = document.querySelector(${JSON.stringify(selector)});
		element.scrollIntoView({ block: 'center' });
		const box = element.getBoundingClientRect();
		const top = ${JSON.stringify(edge)} === 'top' ? 8 : ${JSON.stringify(edge)} === 'bottom' ? innerHeight - box.height - 8 : innerHeight / 2;
		scrollBy(0, box.top - top);
		return new Promise(resolve => {
			const observer = new MutationObserver(() => {
				if (document.querySelector('.reply-hint')) { observer.disconnect(); resolve(); }
			});
			observer.observe(document.body, { childList: true });
			const range = document.createRange();
			range.selectNodeContents(element);
			getSelection().addRange(range);
		});
	})()`,
		true,
	);
}

/** Optional evidence stays outside the shipped skill and test scratch cleanup. */
async function shot(cdp: Cdp, name: string) {
	const { NOTE_SHOTS: folder } = process.env;
	if (!folder) {
		return;
	}
	mkdirSync(folder, { recursive: true });
	const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await Bun.write(join(folder, `${name}.png`), Buffer.from(data, "base64"));
}

/** Measure the visible surface, bounds and stacking, not the runtime's chosen coordinates. */
const MEASURE = `(selector) => {
	const el = document.querySelector(selector);
	const box = el.getBoundingClientRect();
	const style = getComputedStyle(el);
	const column = document.querySelector('main').getBoundingClientRect();
	const sample = document.createElement('span');
	sample.style.background = 'var(--surface)';
	document.body.append(sample);
	const surface = getComputedStyle(sample).backgroundColor;
	sample.remove();
	const left = Math.max(8, column.left), right = Math.min(innerWidth - 8, column.right);
	return {
		opaque: style.backgroundColor === surface,
		border: parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none',
		shadow: style.boxShadow !== 'none',
		inside: box.left >= left - 1 && box.right <= right + 1 && box.top >= 7 && box.bottom <= innerHeight - 7,
		onTop: el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
	};
}`;

/** Exercise the same selection-to-editor journey at each edge and in nested content. */
async function scenario(cdp: Cdp, label: string, name: string, selector: string, edge: string) {
	const failed: string[] = [];
	if (name === "term") {
		await cdp.evaluate(
			"document.querySelector('.reply-pop .btn')?.click(); getSelection().removeAllRanges()",
		);
		await runStep(cdp, `hover:${selector}`, () => "");
		const point = await cdp.evaluate<{ x: number; y: number }>(`(() => {
			const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
			return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
		})()`);
		await runStep(cdp, `click:${point.x},${point.y}`, () => "");
	} else {
		await select(cdp, selector, edge);
	}
	await shot(cdp, `${label}-hint`);
	const hint = await cdp.evaluate<Record<string, boolean>>(`(${MEASURE})('.reply-hint')`);
	const nextReadable = await cdp.evaluate<boolean>(`(() => {
		const hint = document.querySelector('.reply-hint').getBoundingClientRect();
		const selection = ${name === "term" ? "document.querySelector('#term').getBoundingClientRect()" : "getSelection().getRangeAt(0).getBoundingClientRect()"};
		return hint.bottom <= selection.bottom || hint.left >= selection.right;
	})()`);
	// At 8 px from the top a full-width selection leaves neither an above nor a beside slot; below is the bounded fallback.
	if (name !== "top" && !nextReadable) {
		failed.push(`${label}: next line covered`);
	}
	await cdp.evaluate("document.querySelector('.reply-hint').click()");
	await shot(cdp, `${label}-editor`);
	const editor = await cdp.evaluate<Record<string, boolean>>(`(${MEASURE})('.reply-pop')`);
	for (const [kind, result] of [
		["hint", hint],
		["editor", editor],
	] as const) {
		for (const [rule, ok] of Object.entries(result)) {
			if (!ok) {
				failed.push(`${label} ${kind}: ${rule}`);
			}
		}
	}
	return failed;
}

test("selection notes have opaque surfaces and stay in the column and viewport without covering the next line", async () => {
	const path = await packedMdx(dir, "selection-notes", PAGE);
	const failures = await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		const failed: string[] = [];
		for (const viewport of WIDTHS) {
			await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
			for (const scheme of ["light", "dark"]) {
				await cdp.send("Emulation.setEmulatedMedia", {
					features: [{ name: "prefers-color-scheme", value: scheme }],
				});
				await load(cdp, `file://${path}`);
				for (const [name, selector, edge] of [
					["top", "#passage", "top"],
					["bottom", "#passage", "bottom"],
					["right", "#right", "center"],
					["table", "#cell", "center"],
					["code", "pre code", "center"],
					["term", "#term", "center"],
				] as const) {
					failed.push(
						...(await scenario(cdp, `${viewport.width}-${scheme}-${name}`, name, selector, edge)),
					);
				}
			}
		}
		return failed;
	});
	expect(failures).toEqual([]);
}, 60_000);
