import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { act, FRAMES, inPage, load, packedMdx, packMdx, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const SIZES = `[{ size: "5 kWh", price: 4200, back: 10 }, { size: "10 kWh", price: 7900, back: 17 }, { size: "15 kWh", price: 11200, back: 23 }, { size: "None yet", price: 0 }]`;
const COLS = `[{ head: "Size", value: "size" }, { head: "Price", value: "price", format: { currency: "EUR" } }, { head: "Paid back in", value: "back", format: { unit: "years" } }]`;
const page = (props: string) =>
	`import { Question } from "kit";\n\n# Sizes\n\n## The first 5 kWh pays back in 10 years\n\n<Question name="size" legend="Which size?" rows={${SIZES}} cols={${COLS}} ${props} />\n`;

/** Clicks the centre of the first element `selector` matches with the mouse, as a reader does. */
async function clickOn(cdp: Cdp, selector: string) {
	const { x, y } = await cdp.evaluate<{ x: number; y: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		el.scrollIntoView({ block: "center" });
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	}
	await cdp.evaluate(`${FRAMES}.then(() => ${FRAMES})`, true);
}

/** Drags the mouse with the button held across the text of the first element `selector` matches, from its first to its last character. */
async function dragAcross(cdp: Cdp, selector: string) {
	const { x1, x2, y } = await cdp.evaluate<{ x1: number; x2: number; y: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		el.scrollIntoView({ block: "center" });
		const range = document.createRange();
		range.selectNodeContents(el);
		const r = range.getBoundingClientRect();
		return { x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2 };
	})()`);
	const at = (type: string, x: number, buttons: number) =>
		cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
	await at("mousePressed", x1, 1);
	await at("mouseMoved", (x1 + x2) / 2, 1);
	await at("mouseMoved", x2, 1);
	await at("mouseReleased", x2, 0);
	await cdp.evaluate(`${FRAMES}.then(() => ${FRAMES})`, true);
}

/** Presses a key on the focused element. */
async function press(cdp: Cdp, key: string, keyCode: number) {
	for (const type of ["rawKeyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code: key,
			windowsVirtualKeyCode: keyCode,
		});
	}
	await cdp.evaluate(`${FRAMES}.then(() => ${FRAMES})`, true);
}

const CHOSEN = `[...document.querySelectorAll("input[name=size]")].filter((i) => i.checked).map((i) => i.value).join()`;
/** A row's cell, by the row's value and the cell's column (1 is the first after the row head). */
const cell = (value: string, column: number) =>
	`tr:has(> th input[value="${value}"]) > td:nth-of-type(${column})`;

/** Reads the group as assistive technology does, clicks a cell of the 15 kWh row, arrows up, reloads, replies and prints. */
async function chooseAndReply(cdp: Cdp) {
	await cdp.send("Accessibility.enable");
	const { nodes } = await cdp.send<{
		nodes: { role?: { value: string }; name?: { value: string } }[];
	}>("Accessibility.getFullAXTree");
	const named = (role: string) =>
		nodes.filter((n) => n.role?.value === role).map((n) => n.name?.value);
	await clickOn(cdp, cell("15 kWh", 2));
	const clicked = await cdp.evaluate(CHOSEN);
	const weights = await cdp.evaluate<string>(
		`[...document.querySelectorAll("tbody th")].map((th) => getComputedStyle(th.querySelector("label")).fontWeight).join()`,
	);
	await press(cdp, "ArrowUp", 38);
	const arrowed = await cdp.evaluate(CHOSEN);
	await load(cdp);
	const reloaded = await cdp.evaluate(CHOSEN);
	const reply = await act(
		cdp,
		`document.querySelector(".reply-bar .primary").click()`,
		`document.querySelector(".reply-md").textContent.split("\\n").filter((line) => line.startsWith("- "))`,
	);
	await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
	const printed = await cdp.evaluate(
		`(() => { const i = document.querySelector("input[name=size]:checked"); const s = getComputedStyle(i); return [i.checkVisibility(), s.printColorAdjust]; })()`,
	);
	return {
		groups: named("group"),
		radios: named("radio"),
		clicked,
		weights,
		arrowed,
		reloaded,
		reply,
		printed,
	};
}

describe("Question over table rows", () => {
	test("each row is one option of one radio group, written in the page before any script, ids name-value", async () => {
		const output = await packedMdx(dir, "static", page('recommended="5 kWh"'));
		const html = readFileSync(output, "utf8");
		const fieldset = html.match(/<fieldset data-reply>[\s\S]*?<\/fieldset>/)?.[0] ?? "";
		expect(fieldset).toContain("<legend>Which size?</legend>");
		expect(fieldset).toContain('<table class="compare">');
		expect(fieldset.match(/<input type="radio" name="size"[^>]*\/>/g)).toEqual([
			'<input type="radio" name="size" value="5 kWh" id="size-5_20_kWh"/>',
			'<input type="radio" name="size" value="10 kWh" id="size-10_20_kWh"/>',
			'<input type="radio" name="size" value="15 kWh" id="size-15_20_kWh"/>',
			'<input type="radio" name="size" value="None yet" id="size-None_20_yet"/>',
		]);
		expect(html).not.toContain("<!--island:");
	});

	for (const viewport of WIDTHS) {
		test(`at ${viewport.width} px a click anywhere on a row chooses it, arrows move the choice, the choice shows without colour, is kept and replies`, async () => {
			const output = await packedMdx(dir, `rows-${viewport.width}`, page('recommended="5 kWh"'));
			const seen = await inPage(output, chooseAndReply, viewport);
			expect(seen.groups).toContain("Which size?");
			expect(seen.radios).toEqual(["5 kWh Recommended", "10 kWh", "15 kWh", "None yet"]);
			expect(seen.clicked).toBe("15 kWh");
			// The chosen row's name is bolder than the others, beside a filled dot: not told by colour alone.
			const [w5, w10, w15, wNone] = seen.weights.split(",").map(Number);
			expect([w5, w10, wNone].every((w) => Number(w) < Number(w15))).toBe(true);
			expect(seen.arrowed).toBe("10 kWh");
			expect(seen.reloaded).toBe("10 kWh");
			expect(seen.reply).toEqual(["- Which size? 10 kWh"]);
			expect(seen.printed).toEqual([true, "exact"]);
		}, 30_000);
	}

	test("on a phone, with the table kept whole and scrolling sideways, a click on a row's last cell still chooses it", async () => {
		const output = await packedMdx(dir, "scrolling", page(""));
		const chosen = await inPage(
			output,
			async (cdp) => {
				await cdp.evaluate(`(() => {
					const table = document.querySelector("fieldset table");
					const scroll = document.createElement("div");
					scroll.className = "scroll";
					table.classList.add("table");
					table.before(scroll);
					scroll.append(table);
					table.style.minInlineSize = "40rem";
					scroll.scrollLeft = scroll.scrollWidth;
				})()`);
				await clickOn(cdp, cell("None yet", 2));
				return cdp.evaluate(CHOSEN);
			},
			WIDTHS[1],
		);
		expect(chosen).toBe("None yet");
	}, 30_000);

	test("on a phone the chosen row's name, which stays in view as the table scrolls, carries the row's tint", async () => {
		const output = await packedMdx(dir, "phone-tint", page(""));
		const tints = await inPage(
			output,
			async (cdp) => {
				await clickOn(cdp, cell("10 kWh", 1));
				return cdp.evaluate<string[]>(`(() => {
					const row = document.querySelector("input[value='10 kWh']").closest("tr");
					return [getComputedStyle(row.querySelector("th")).position, getComputedStyle(row.querySelector("th")).backgroundColor, getComputedStyle(row.querySelector("td")).backgroundColor === "rgba(0, 0, 0, 0)" ? getComputedStyle(row).backgroundColor : getComputedStyle(row.querySelector("td")).backgroundColor];
				})()`);
			},
			WIDTHS[1],
		);
		expect(tints[0]).toBe("sticky");
		expect(tints[1]).toBe(tints[2]);
	}, 30_000);

	test("multiple, checked and a note come from Question; a link in a row stays a link", async () => {
		const output = await packedMdx(
			dir,
			"multiple",
			`import { Question } from "kit";\n\n# Sizes\n\n<Question name="size" legend="Which sizes?" rows={${SIZES}} cols={[{ head: "Size", value: "size", link: (s) => "#" + s.size.replace(" ", "") }, { head: "Price", value: "price" }]} multiple checked={["5 kWh"]} note />\n\n<p id="5kWh">Five</p>\n`,
		);
		const seen = await inPage(output, async (cdp) => {
			await clickOn(cdp, cell("15 kWh", 1));
			const chosen = await cdp.evaluate(CHOSEN);
			await clickOn(cdp, 'a[href="#5kWh"]');
			return [chosen, await cdp.evaluate("location.hash"), await cdp.evaluate(CHOSEN)];
		});
		expect(seen).toEqual(["5 kWh,15 kWh", "#5kWh", "5 kWh,15 kWh"]);
		expect(readFileSync(output, "utf8")).toContain('type="checkbox" name="size" value="5 kWh"');
	}, 30_000);
});

describe("Question over table rows at pack", () => {
	test("props the rows cannot use fail the pack, saying what to write", async () => {
		const failed = async (name: string, props: string) => {
			const { result } = await packMdx(
				dir,
				name,
				`import { Question } from "kit";\n\n# Fails\n\n<Question name="size" legend="Which size?" ${props} />\n`,
			);
			return [result.code, result.stderr.trim()];
		};
		const rows = `rows={${SIZES}}`;
		expect(await failed("both", `${rows} cols={${COLS}} options={["a"]}`)).toEqual([
			1,
			expect.stringContaining('<Question name="size"> has options and rows'),
		]);
		expect(await failed("no-cols", rows)).toEqual([
			1,
			expect.stringContaining('<Question name="size"> has rows but no cols'),
		]);
		expect(await failed("answer", `${rows} cols={${COLS}} answer="5 kWh"`)).toEqual([
			1,
			expect.stringContaining('<Question name="size"> has rows and an answer'),
		]);
		expect(
			await failed("named", `${rows} cols={[{ head: "Size", value: (s) => <b>{s.size}</b> }]}`),
		).toEqual([1, expect.stringContaining("its first column gives each row's value")]);
		expect(await failed("unknown", `${rows} cols={${COLS}} recommended="20 kWh"`)).toEqual([
			1,
			expect.stringContaining('recommends "20 kWh", which is not one of its option values'),
		]);
		expect(await failed("unchecked", `${rows} cols={${COLS}} checked="20 kWh"`)).toEqual([
			1,
			expect.stringContaining('checks "20 kWh", which is not one of its option values'),
		]);
		expect(await failed("options-unchecked", `options={["a", "b"]} checked="c"`)).toEqual([
			1,
			expect.stringContaining('checks "c", which is not one of its option values'),
		]);
		expect(
			await failed(
				"blank",
				`rows={[{ size: "5 kWh" }, { size: " " }]} cols={[{ head: "Size", value: "size" }]}`,
			),
		).toEqual([1, expect.stringContaining("has a row whose first column is empty")]);
	}, 30_000);
});

describe("Question over table rows, beside other controls and in forced colours", () => {
	test("a button, a fold, a control and text in a row's other cells stay their own: only a plain click on the row chooses it", async () => {
		const output = await packedMdx(
			dir,
			"busy-rows",
			`import { Question } from "kit";\n\n# Sizes\n\n<Question name="size" legend="Which size?" rows={${SIZES}} cols={[{ head: "Size", value: "size" }, { head: "Price", value: "price", format: { currency: "EUR" } }, { head: "Why", value: (s) => <details><summary>Why {s.size}</summary>Because.</details> }, { head: "Act", value: (s) => <button type="button" data-copy={s.size}>Copy</button> }, { head: "Mine", value: (s) => <label><input type="checkbox" data-mine={s.size} /> keep</label> }]} />\n`,
		);
		const seen = await inPage(output, async (cdp) => {
			await cdp.evaluate(
				`document.querySelector('[data-copy="10 kWh"]').addEventListener("click", () => { window.copied = true; })`,
			);
			await clickOn(cdp, '[data-copy="10 kWh"]');
			const button = await cdp.evaluate(`[window.copied === true, ${CHOSEN}]`);
			await clickOn(cdp, 'tr:has([data-copy="15 kWh"]) summary');
			const fold = await cdp.evaluate(
				`[document.querySelector('tr:has([data-copy="15 kWh"]) details').open, ${CHOSEN}]`,
			);
			await clickOn(cdp, '[data-mine="5 kWh"]');
			const mine = await cdp.evaluate(
				`[document.querySelector('[data-mine="5 kWh"]').checked, getComputedStyle(document.querySelector('[data-mine="5 kWh"]')).appearance, getComputedStyle(document.querySelector("#size-5_20_kWh")).appearance, ${CHOSEN}]`,
			);
			await dragAcross(cdp, cell("None yet", 1));
			const dragged = await cdp.evaluate(`[getSelection().toString(), ${CHOSEN}]`);
			await clickOn(cdp, cell("10 kWh", 1));
			return { button, fold, mine, dragged, plain: await cdp.evaluate(CHOSEN) };
		});
		expect(seen.button).toEqual([true, ""]);
		expect(seen.fold).toEqual([true, ""]);
		expect(seen.mine).toEqual([true, "auto", "none", ""]);
		expect(seen.dragged).toEqual(["€0", ""]);
		expect(seen.plain).toBe("10 kWh");
	}, 30_000);

	test("with forced colours, a chosen radio or check box looks unlike an unchosen one, in rows and in a Question's options", async () => {
		const output = await packedMdx(
			dir,
			"forced",
			`import { Question } from "kit";\n\n# Forced\n\n<Question name="one" legend="One" rows={${SIZES}} cols={${COLS}} checked="10 kWh" />\n\n<Question name="many" legend="Many" rows={${SIZES}} cols={${COLS}} multiple checked={["10 kWh"]} />\n\n<Question name="pick" legend="Pick" options={["a", "b"]} checked="b" />\n\n<Question name="picks" legend="Picks" options={["a", "b"]} multiple checked={["b"]} />\n`,
		);
		const pairs = await inPage(
			output,
			async (cdp) => {
				await cdp.send("Emulation.setEmulatedMedia", {
					features: [
						{ name: "prefers-reduced-motion", value: "reduce" },
						{ name: "forced-colors", value: "active" },
					],
				});
				await cdp.evaluate(`${FRAMES}.then(() => ${FRAMES})`, true);
				// A row's mark is its input; an option's is the dot drawn at the start of its text. A chosen mark is filled, so it
				// has clearly more pixels unlike the background than an unchosen one.
				const ink = async (selector: string, dot: boolean) => {
					const clip = await cdp.evaluate<{
						x: number;
						y: number;
						width: number;
						height: number;
					}>(`(() => {
					const el = document.querySelector(${JSON.stringify(selector)});
					const r = el.getBoundingClientRect();
					const box = ${dot} ? { x: r.left + 8, y: r.top + r.height / 2 - 12, width: 24, height: 24 } : { x: r.left - 2, y: r.top - 2, width: r.width + 4, height: r.height + 4 };
					return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
				})()`);
					// The page fits the window: capturing beyond it would end the forced-colours emulation.
					const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
						clip: { ...clip, scale: 1 },
					});
					return cdp.evaluate<number>(
						`new Promise((done) => { const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 96) n++; done(n); }; img.src = "data:image/png;base64,${data}"; })`,
						true,
					);
				};
				const differ = async (on: string, off: string, dot = false) =>
					(await ink(on, dot)) > 1.3 * (await ink(off, dot));
				return [
					await differ("#one-10_20_kWh", "#one-15_20_kWh"),
					await differ("#many-10_20_kWh", "#many-15_20_kWh"),
					await differ("#pick-b + span", "#pick-a + span", true),
					await differ("#picks-b + span", "#picks-a + span", true),
				];
			},
			{ width: 1440, height: 1400, mobile: false },
		);
		expect(pairs).toEqual([true, true, true, true]);
	}, 30_000);
});
