import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { runStep } from "../skills/explainer/src/steps.ts";
import { withTestPage } from "./browser.ts";
import { load, packedMdx, scratch, until, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PASSAGE =
	"A selected paragraph explains how the pieces fit together, with enough words to wrap across several lines on a phone.";

const PAGE = `---
title: Selection notes
reply: true
---

# Selection notes

Select a passage to send feedback.

<div style={{ height: "100vh" }} />

<p id="passage">${PASSAGE}</p>
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

const settleMarks = (cdp: Cdp) =>
	cdp.evaluate(
		"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		true,
	);

async function saveNote(cdp: Cdp, value: string) {
	await cdp.evaluate(`(() => {
		document.querySelector('.reply-hint').click();
		const editor = document.querySelector('.reply-pop');
		const text = editor.querySelector('textarea');
		text.value = ${JSON.stringify(value)};
		text.dispatchEvent(new Event('input', { bubbles: true }));
		editor.querySelector('.primary').click();
		// Dismiss “Note saved” without leaving the noted passage.
		document.querySelector('.reply-pop button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		getSelection().removeAllRanges();
	})()`);
	await settleMarks(cdp);
}

const markNames = (cdp: Cdp) =>
	cdp.evaluate<string[]>(
		"[...document.querySelectorAll('.reply-mark:not([hidden])')].map(mark => mark.getAttribute('aria-label'))",
	);

test("saved marks reopen their own note and follow removal, reload and Clear", async () => {
	const path = await packedMdx(
		dir,
		"saved-marks",
		PAGE.replace(
			`<p id="passage">${PASSAGE}</p>`,
			`<p>${PASSAGE}</p>
<p id="passage">${PASSAGE.replace("selected paragraph", "<em>selected paragraph</em>")}</p>`,
		).replace(
			"<h3>What each stack has</h3>",
			`<h3 id="heading">What each stack has</h3>

<figure aria-label="The system"><svg viewBox="0 0 200 60" width="200" height="60"><rect id="pump" aria-label="Pump" data-ref="pump" x="10" y="8" width="42" height="30" fill="currentColor" /></svg></figure>`,
		),
	);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}`);
		await select(cdp, "#passage", "center");
		await saveNote(cdp, "First note");
		await select(cdp, "#heading", "center");
		await saveNote(cdp, "Heading note");
		await cdp.evaluate(
			"document.querySelector('#pump').dispatchEvent(new MouseEvent('click', { bubbles: true }))",
		);
		await saveNote(cdp, "Figure note");
		const expected = [
			"Note on “A selected paragraph explains how the pieces fit together, w…”",
			"Note on “What each stack has”",
			"Note on “Pump”",
		] as const;
		expect(await markNames(cdp)).toEqual([...expected]);
		await load(cdp);
		await settleMarks(cdp);
		expect(await markNames(cdp)).toEqual([...expected]);
		expect(
			await cdp.evaluate(`
			[...CSS.highlights.get('explainer-notes')].some(range =>
				range.toString() === ${JSON.stringify(PASSAGE)} && range.commonAncestorContainer.id === 'passage')
		`),
		).toBe(true);
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 390,
			height: 844,
			mobile: true,
			deviceScaleFactor: 1,
		});
		await settleMarks(cdp);
		await cdp.evaluate("document.querySelector('#passage').scrollIntoView({ block: 'center' })");
		await settleMarks(cdp);
		expect(
			await cdp.evaluate(`(() => {
			const mark = document.querySelector('.reply-mark');
			const { right } = document.querySelector('#passage').getBoundingClientRect();
			const { top, height } = mark.getBoundingClientRect();
			const hit = document.elementFromPoint(right - 2, top + height / 2);
			return hit !== null && !mark.contains(hit);
		})()`),
		).toBe(true);
		await cdp.evaluate("document.querySelectorAll('.reply-mark')[1].focus()");
		await runStep(cdp, "key:Enter", () => "");
		expect(
			await cdp.evaluate(`({
			focus: document.activeElement.tagName,
			note: document.activeElement.value,
			popover: document.activeElement.closest('.reply-note-pop')?.getAttribute('aria-label'),
			dialog: document.querySelector('.reply-dialog').open,
		})`),
		).toEqual({
			focus: "TEXTAREA",
			note: "Heading note",
			popover: expected[1],
			dialog: false,
		});
		await cdp.evaluate("document.querySelector('.reply-note-pop .reply-delete').click()");
		await settleMarks(cdp);
		expect(await markNames(cdp)).toEqual([expected[0], expected[2]]);
		await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
		expect(
			await cdp.evaluate(
				"[...document.querySelectorAll('.reply-mark, #pump')].map(el => el.id ? getComputedStyle(el).outlineStyle : getComputedStyle(el).display)",
			),
		).toEqual(["none", "none", "none"]);
		await cdp.send("Emulation.setEmulatedMedia", { media: "screen" });
		await cdp.evaluate(
			"const clear = document.querySelector('.reply-bar .btn:not(.primary)'); clear.click(); clear.click()",
		);
		await settleMarks(cdp);
		expect(await markNames(cdp)).toEqual([]);
	});
}, 20_000);

test("a saved mark does not move to another filled record with identical text", async () => {
	const path = await packedMdx(
		dir,
		"record-marks",
		`---
reply: true
---
import { View } from "kit";
import { RecordBody } from "./record.tsx";

# Work list

[First](#item/a) · [Second](#item/b)

<View name="item" records={[{id: "a"}, {id: "b"}]} render={RecordBody} />
`,
		{
			"record.tsx": `"use client";
export function RecordBody() {
	return <><h1>Same heading</h1><p id="shared">Same body in every record.</p></>;
}
`,
		},
	);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}#item/a`);
		await select(cdp, "#shared", "center");
		await saveNote(cdp, "This is about the first record");
		const expected = ["Note on “Same body in every record.”"];
		expect(await markNames(cdp)).toEqual(expected);
		await load(cdp, `file://${path}#item/b`);
		await settleMarks(cdp);
		expect(await markNames(cdp)).toEqual([]);
		await load(cdp, `file://${path}#item/a`);
		expect(await until(cdp, "document.querySelector('.reply-mark:not([hidden])') !== null")).toBe(
			true,
		);
		expect(await markNames(cdp)).toEqual(expected);
	});
}, 20_000);

/** The open popover, and how it sits against the lines of what it is about. */
const POPOVER = `(() => {
	const pop = document.querySelector('.reply-note-pop');
	if (!pop) return null;
	const box = pop.getBoundingClientRect();
	const lit = [...(CSS.highlights.get('explainer-note-current') ?? [])];
	const lines = lit.flatMap(range => [...range.getClientRects()]).filter(r => r.width && r.height);
	const parts = [...document.querySelectorAll('.is-note-current')].map(el => el.getBoundingClientRect());
	const all = [...lines, ...parts];
	return {
		label: pop.getAttribute('aria-label'),
		text: pop.querySelector('textarea').value,
		focused: document.activeElement === pop.querySelector('textarea'),
		lit: lit.map(range => range.toString().replace(/\\s+/g, ' ').trim()).concat([...document.querySelectorAll('.is-note-current')].map(el => el.id)),
		covers: all.some(r => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top),
		side: all.length === 0 ? 'none' : box.top >= Math.max(...all.map(r => r.bottom)) ? 'below' : box.bottom <= Math.min(...all.map(r => r.top)) ? 'above' : 'over',
		inView: box.top >= 0 && box.bottom <= innerHeight,
	};
})()`;

interface Popover {
	label: string;
	text: string;
	focused: boolean;
	lit: string[];
	covers: boolean;
	side: string;
	inView: boolean;
}

const notesPage = (name: string) =>
	packedMdx(
		dir,
		name,
		PAGE.replace(
			"<h3>What each stack has</h3>",
			`<h3 id="heading">What each stack has</h3>

<figure aria-label="The system"><svg viewBox="0 0 200 60" width="200" height="60"><rect id="pump" aria-label="Pump" data-ref="pump" x="10" y="8" width="42" height="30" fill="currentColor" /></svg></figure>`,
		),
	);

/** A viewport point inside the first line of what `selector` holds. */
const pointIn = (cdp: Cdp, selector: string) =>
	cdp.evaluate<string>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		const range = document.createRange();
		range.selectNodeContents(el);
		const line = [...range.getClientRects()].find(r => r.width > 40) ?? el.getBoundingClientRect();
		return Math.round(line.left + 20) + ',' + Math.round(line.top + line.height / 2);
	})()`);

test("a new note's popover lights what it is about and opens clear of it, above near the window's bottom", async () => {
	const path = await notesPage("create-popover");
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		for (const viewport of WIDTHS) {
			await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
			await load(cdp, `file://${path}`);
			for (const [edge, side] of [
				["center", "below"],
				["bottom", "above"],
			] as const) {
				await select(cdp, "#passage", edge);
				await cdp.evaluate("document.querySelector('.reply-hint').click()");
				await settleMarks(cdp);
				const pop = await cdp.evaluate<Popover>(POPOVER);
				const at = `${viewport.width} ${edge}`;
				expect({ at, ...pop }).toEqual({
					at,
					label: "Add note",
					text: "",
					focused: true,
					lit: [PASSAGE],
					covers: false,
					side,
					inView: true,
				});
				// Escape on an empty new note leaves no note and no light.
				await runStep(cdp, "key:Escape", () => "");
				await settleMarks(cdp);
				expect(
					await cdp.evaluate(
						"[document.querySelector('.reply-note-pop'), CSS.highlights.get('explainer-note-current').size, ReplyNotes.markdown().includes('Notes')]",
					),
				).toEqual([null, 0, false]);
			}
			await cdp.evaluate(
				"getSelection().removeAllRanges(); document.querySelector('#pump').scrollIntoView({ block: 'center' }); document.querySelector('#pump').dispatchEvent(new MouseEvent('click', { bubbles: true }))",
			);
			await cdp.evaluate("document.querySelector('.reply-hint').click()");
			await settleMarks(cdp);
			const part = await cdp.evaluate<Popover>(POPOVER);
			expect([part.label, part.lit, part.covers, part.side]).toEqual([
				"Add note",
				["pump"],
				false,
				"below",
			]);
			await runStep(cdp, "key:Escape", () => "");
		}
	});
}, 30_000);

test("a saved note opens from its highlight or button, edits in place, closes with focus back, and deletes", async () => {
	const path = await notesPage("saved-popover");
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}`);
		await select(cdp, "#passage", "center");
		await saveNote(cdp, "First note");
		const name = "Note on “A selected paragraph explains how the pieces fit together, w…”";
		// Pointing at the highlight shows it opens; it does not open on hover.
		await runStep(cdp, `hover:${await pointIn(cdp, "#passage")}`, () => "");
		await settleMarks(cdp);
		expect(
			await cdp.evaluate(
				"[getComputedStyle(document.querySelector('#passage')).cursor, CSS.highlights.get('explainer-note-hover').size, document.querySelector('.reply-note-pop')]",
			),
		).toEqual(["pointer", 1, null]);
		await runStep(cdp, `click:${await pointIn(cdp, "#passage")}`, () => "");
		await settleMarks(cdp);
		const opened = await cdp.evaluate<Popover>(POPOVER);
		expect([opened.label, opened.text, opened.focused, opened.lit, opened.covers]).toEqual([
			name,
			"First note",
			true,
			[PASSAGE],
			false,
		]);
		expect(
			await cdp.evaluate(
				"[document.querySelector('.reply-dialog').open, document.querySelector('.reply-mark').getAttribute('aria-expanded')]",
			),
		).toEqual([false, "true"]);
		await cdp.send("Input.insertText", { text: ", edited" });
		expect(await cdp.evaluate("ReplyNotes.markdown().includes('First note, edited')")).toBe(true);
		// Escape closes and returns focus to the note's button, from which Enter opens it again.
		await runStep(cdp, "key:Escape", () => "");
		expect(
			await cdp.evaluate(
				"[document.querySelector('.reply-note-pop'), document.activeElement.getAttribute('aria-label')]",
			),
		).toEqual([null, name]);
		await runStep(cdp, "key:Enter", () => "");
		expect((await cdp.evaluate<Popover>(POPOVER)).text).toBe("First note, edited");
		// A press elsewhere closes it, keeping the note.
		await runStep(cdp, `click:${await pointIn(cdp, "#right")}`, () => "");
		expect(await cdp.evaluate("document.querySelector('.reply-note-pop')")).toBe(null);
		// A noted part opens its note rather than offering a new one.
		await cdp.evaluate(
			"document.querySelector('#pump').dispatchEvent(new MouseEvent('click', { bubbles: true }))",
		);
		await saveNote(cdp, "Pump note");
		await cdp.evaluate(
			"document.querySelector('#pump').dispatchEvent(new MouseEvent('click', { bubbles: true }))",
		);
		await settleMarks(cdp);
		expect(
			await cdp.evaluate(
				"[document.querySelector('.reply-hint'), document.querySelector('.reply-note-pop textarea')?.value]",
			),
		).toEqual([null, "Pump note"]);
		await runStep(cdp, "key:Escape", () => "");
		// The edit and both marks come back after a reload; Delete removes the note and its mark.
		await load(cdp);
		await settleMarks(cdp);
		await cdp.evaluate("document.querySelector('#passage').scrollIntoView({ block: 'center' })");
		await settleMarks(cdp);
		await runStep(cdp, `click:${await pointIn(cdp, "#passage")}`, () => "");
		await settleMarks(cdp);
		expect((await cdp.evaluate<Popover>(POPOVER)).text).toBe("First note, edited");
		await cdp.evaluate("document.querySelector('.reply-note-pop .reply-delete').click()");
		await settleMarks(cdp);
		expect(await markNames(cdp)).toEqual(["Note on “Pump”"]);
		expect(
			await cdp.evaluate(
				"[document.querySelector('.reply-note-pop'), ReplyNotes.markdown().includes('First note'), CSS.highlights.get('explainer-notes').size]",
			),
		).toEqual([null, false, 0]);
	});
}, 30_000);

const CLOSING_PAGE = `---
title: Closing notes
reply: true
---
import { Question } from "kit";

# Closing notes

<p id="passage">${PASSAGE}</p>
<p id="right">A second passage for a draft.</p>

<div id="scroller" style={{ height: "160px", overflow: "auto" }}><p id="inner">A passage in a box that scrolls.</p><div style={{ height: "600px" }} /></div>

## Sizes

<Question name="size" legend="Which size?" rows={[{ size: "5 kWh", price: "4200 euros" }, { size: "10 kWh", price: "7900 euros" }]} cols={[{ head: "Size", value: "size" }, { head: "Price", value: "price" }]} />

<div style={{ height: "100vh" }} />
`;

/** Where focus and the text cursor are, and which notes are left. */
const AFTER_CLOSE = `({
	popover: document.querySelector('.reply-note-pop') !== null,
	focus: document.activeElement.getAttribute('aria-label') ?? document.activeElement.tagName,
	caret: getSelection().isCollapsed && document.querySelector('#passage').contains(getSelection().anchorNode),
	hint: document.querySelector('.reply-hint') !== null,
	notes: [...document.querySelectorAll('.reply-mark')].map(mark => mark.getAttribute('aria-label')),
})`;

test("closing a note keeps the reader's place and focus, and the popover follows a box that scrolls", async () => {
	const path = await packedMdx(dir, "closing", CLOSING_PAGE);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}`);
		// Delete from the highlight: the note's button goes with it, so the caret goes back to its text.
		await select(cdp, "#passage", "center");
		await saveNote(cdp, "First note");
		await runStep(cdp, `click:${await pointIn(cdp, "#passage")}`, () => "");
		await settleMarks(cdp);
		await cdp.evaluate("document.querySelector('.reply-note-pop .reply-delete').click()");
		await settleMarks(cdp);
		expect(await cdp.evaluate(AFTER_CLOSE)).toEqual({
			popover: false,
			focus: "BODY",
			caret: true,
			hint: false,
			notes: [],
		});
		// Emptied and closed with Escape from its button, a note is gone the same way.
		await select(cdp, "#passage", "center");
		await saveNote(cdp, "Second note");
		await cdp.evaluate("document.querySelector('.reply-mark').click()");
		await cdp.evaluate(
			"(() => { const text = document.querySelector('.reply-note-pop textarea'); text.value = ''; text.dispatchEvent(new Event('input', { bubbles: true })); })()",
		);
		await runStep(cdp, "key:Escape", () => "");
		await settleMarks(cdp);
		expect(await cdp.evaluate(AFTER_CLOSE)).toMatchObject({
			popover: false,
			caret: true,
			notes: [],
		});
		// A press outside a new note's popover keeps what was written and leaves focus where the press put it.
		await select(cdp, "#right", "center");
		await cdp.evaluate("document.querySelector('.reply-hint').click()");
		await cdp.send("Input.insertText", { text: "Draft" });
		await runStep(cdp, `click:${await pointIn(cdp, "#passage")}`, () => "");
		await settleMarks(cdp);
		expect(await cdp.evaluate(AFTER_CLOSE)).toMatchObject({
			popover: false,
			focus: "BODY",
			notes: ["Note on “A second passage for a draft.”"],
		});
		expect(await cdp.evaluate("ReplyNotes.markdown().includes('Draft')")).toBe(true);
		// The popover moves with a target that scrolls inside a box, staying clear of it.
		await select(cdp, "#inner", "center");
		await cdp.evaluate("document.querySelector('.reply-hint').click()");
		await settleMarks(cdp);
		const gap = `(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('#inner')); return Math.round(document.querySelector('.reply-note-pop').getBoundingClientRect().top - range.getBoundingClientRect().bottom); })()`;
		const before = await cdp.evaluate<number>(gap);
		await cdp.evaluate("document.querySelector('#scroller').scrollTop = 40");
		await settleMarks(cdp);
		expect([before, await cdp.evaluate<number>(gap)]).toEqual([before, before]);
		await runStep(cdp, "key:Escape", () => "");
	});
}, 30_000);

test("a highlight in a Question's row or option opens its note and keeps the answer; a changed text closes its note", async () => {
	const path = await packedMdx(dir, "closing-question", CLOSING_PAGE);
	await withTestPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${path}`);
		// Clicking a noted cell opens its note; the row's answer stays unchosen.
		await select(cdp, "tbody tr:nth-child(2) td", "center");
		await saveNote(cdp, "Price note");
		await runStep(cdp, `click:${await pointIn(cdp, "tbody tr:nth-child(2) td")}`, () => "");
		await settleMarks(cdp);
		expect(
			await cdp.evaluate(
				"[[...document.querySelectorAll('input[name=size]')].some(i => i.checked), document.querySelector('.reply-note-pop textarea')?.value, document.activeElement.tagName]",
			),
		).toEqual([false, "Price note", "TEXTAREA"]);
		await runStep(cdp, "key:Escape", () => "");
		// So does a noted option's own text, which would otherwise choose it.
		await select(cdp, "tbody tr:nth-child(1) th label span", "center");
		await saveNote(cdp, "Option note");
		await runStep(
			cdp,
			`click:${await pointIn(cdp, "tbody tr:nth-child(1) th label span")}`,
			() => "",
		);
		await settleMarks(cdp);
		expect(
			await cdp.evaluate(
				"[[...document.querySelectorAll('input[name=size]')].some(i => i.checked), document.querySelector('.reply-note-pop textarea')?.value]",
			),
		).toEqual([false, "Option note"]);
		await runStep(cdp, "key:Escape", () => "");
		// When the text an open note is about changes, the popover closes keeping the note, which Reply then edits.
		await select(cdp, "#right", "center");
		await saveNote(cdp, "Draft");
		await runStep(cdp, `click:${await pointIn(cdp, "#right")}`, () => "");
		await settleMarks(cdp);
		await cdp.evaluate("document.querySelector('#right').textContent = 'Rewritten.'");
		await settleMarks(cdp);
		await settleMarks(cdp);
		expect(
			await cdp.evaluate(
				"(document.querySelector('.reply-bar .primary').click(), [document.querySelector('.reply-note-pop'), [...document.querySelectorAll('.reply-dialog textarea')].map(t => t.value)])",
			),
		).toEqual([null, ["Draft"]]);
	});
}, 30_000);
