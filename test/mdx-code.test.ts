import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import {
	DESKTOP,
	inPage,
	packedMdx,
	packMdx,
	pageContract,
	runPacked,
	scratch,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const CODE = [
	"export async function run(api: Api): Promise<void> {",
	"\tconst result = await api.call(`run`, 42);",
	'\tif (result === null) trace("no result for this call, which is a long line that a phone wraps"); // done',
	"}",
].join("\n");

/** A page whose prose and code share the ref call, as #154's author wanted: pointing at a call lights it in the listing. */
const PAGE = `# Calls

Every <span data-ref="call" id="term">call</span> goes through the runtime.

\`\`\`ts ref:call="api.call" ref:trace='trace("'
${CODE}
\`\`\`
`;

/** The text of an element's markup, as a reader copies it. */
const textOf = (html: string) =>
	html
		.replace(/<[^>]+>/g, "")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&amp;", "&");

const codeOf = (html: string) => /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1] ?? "";

/** A client module showing a fence from an .mdx fragment only after a click (Reveal), or as a filled view's record (Item). */
const REVEAL_TSX = `"use client";
import { useState } from "preact/hooks";
import Snippet from "./snippet.mdx";
export function Reveal() {
	const [open, setOpen] = useState(false);
	return <div><button type="button" onClick={() => setOpen(true)}>Show</button>{open ? <Snippet /> : null}</div>;
}
export function Item({ record }: { record: { id: string } }) {
	return <><h1>{record.id}</h1><Snippet /></>;
}
`;

/**
 * Page code listing each token class whose contrast is under 4.5:1 on the code's background or on lit code, in light and dark,
 * with the prose term focused so the marked code is lit; colours are read back as sRGB through a canvas.
 */
const LOW_CONTRAST = `(() => {
				const g = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
				/** The sRGB colour of CSS colours painted one over another. */
				const rgb = (...fills) => { g.clearRect(0, 0, 1, 1); for (const fill of fills) { g.fillStyle = fill; g.fillRect(0, 0, 1, 1); } return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v / 255); };
				const lum = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
				const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
				const code = document.querySelector("pre code");
				const lit = code.querySelector("[data-ref=call]");
				document.getElementById("term").focus();
				const low = lit.classList.contains("is-lit") ? [] : ["the marked code is not lit"];
				for (const scheme of ["light", "dark"]) {
					document.documentElement.dataset.scheme = scheme;
					const under = getComputedStyle(code.parentElement).backgroundColor;
					const backgrounds = { unlit: rgb(under), lit: rgb(under, getComputedStyle(lit).backgroundColor) };
					for (const kind of ["comment", "keyword", "string", "number", "function", "type", "inserted", "deleted"]) {
						const probe = code.appendChild(Object.assign(document.createElement("span"), { className: "tok-" + kind }));
						const ink = rgb(getComputedStyle(probe).color);
						probe.remove();
						for (const [state, background] of Object.entries(backgrounds)) {
							const ratio = contrast(ink, background);
							if (ratio < 4.5) low.push(scheme + " " + state + " " + kind + " " + ratio.toFixed(2));
						}
					}
				}
				return low;
			})()`;

/**
 * Page code for PAGE checking tab widths, where the long line's wraps start, and that focusing the prose term lights the marked
 * code.
 */
const LINES_CONTRACT = `<script>
const ch = (() => { const probe = document.createElement("span"); probe.textContent = "0"; document.querySelector("pre code").append(probe); const width = probe.getBoundingClientRect().width; probe.remove(); return width; })();
const pre = document.querySelector("pre");
const left = pre.getBoundingClientRect().left + parseFloat(getComputedStyle(pre).paddingLeft);
const lines = document.querySelectorAll(".code-line");
/** Columns from the code's start to the start of each line the long string takes, which a phone wraps. */
const boxes = () => { const range = document.createRange(); range.selectNodeContents([...lines[2].querySelectorAll(".tok-string")].at(-1)); const starts = new Map(); for (const r of range.getClientRects()) starts.set(Math.round(r.top), Math.min(starts.get(Math.round(r.top)) ?? r.left, r.left)); return [...starts.values()].map((at) => Math.round((at - left) / ch)); };
/** Columns from the code's start to the first word after a tab. */
const first = () => Math.round((lines[1].querySelector(".tok-keyword").getBoundingClientRect().left - left) / ch);
const phone = matchMedia("(max-width: 40rem), print").matches;
${pageContract({
	"a tab is 4 columns wide, 2 on a phone and paper": `first() === (phone ? 2 : 4)`,
	"a long line wraps on a phone only, continuing 2 columns in from its own start": `(boxes().length > 1) === innerWidth < 640 && boxes().slice(1).every((at) => at === 4)`,
	"focusing the prose term lights the marked code": `(document.getElementById("term").focus(), document.querySelector("pre [data-ref=call]").classList.contains("is-lit"))`,
})}</script></body>`;

describe("code fences", () => {
	test("are coloured when the page packs, with no script, and marked text carries its ref (#154)", async () => {
		const html = readFileSync(await packedMdx(dir, "code", PAGE), "utf8");
		const code = codeOf(html);
		expect(code).toContain('<span class="tok-keyword">export</span>');
		expect(code).toContain(
			'<span data-ref="call"><span class="tok-function">api</span>.<span class="tok-function">call</span></span>',
		);
		expect(code).toContain(
			'<span data-ref="trace"><span class="tok-function">trace</span>(<span class="tok-string">&quot;</span></span>',
		);
		expect(textOf(code)).toBe(`${CODE}\n`);
		expect(html).toContain(".tok-keyword {");

		const plain = readFileSync(
			await packedMdx(dir, "plain", "# Plain\n\n```brainfuck\n++[>+<-]\n```\n"),
			"utf8",
		);
		expect(codeOf(plain)).toBe('<span class="code-line">++[>+&lt;-]</span>\n');
		expect(plain).toContain(".code-line {");
		expect(plain).not.toContain("<script");
	});

	test("cost a page with no fence nothing: no line layout, token colours or lit-code rules", async () => {
		const html = readFileSync(
			await packedMdx(
				dir,
				"none",
				"# No fence\n\nOnly `inline` code.\n\n<pre>a hand-written\tpre</pre>\n",
			),
			"utf8",
		);
		expect(html).not.toMatch(/code-line|tok-|pre \[data-ref\]/);
	});

	test.each([
		["appears after a click", "<Reveal />", 'import { Reveal } from "./reveal.tsx";'],
		[
			"is in a filled record",
			'<View name="item" records={[{ id: "one" }]} render={Item} back="Records" />',
			'import { View } from "kit";\nimport { Item } from "./reveal.tsx";',
		],
	])("bring their stylesheet when a page's only fence %s", async (_, use, imports) => {
		const html = readFileSync(
			await packedMdx(dir, "later", `${imports}\n\n# Later\n\n[One](#item/one)\n\n${use}\n`, {
				"snippet.mdx": "```ts\nconst answer = 42; // later\n```\n",
				"reveal.tsx": REVEAL_TSX,
			}),
			"utf8",
		);
		expect(html).not.toContain('class="code-line"');
		expect(html).toContain(".code-line {");
		expect(html).toContain(".tok-keyword {");
	});

	test.each([
		['```ts ref:call="api.cal1"', 'code.mdx:3: ref:call: the code has no "api.cal1"'],
		["```ts title=run.ts", 'code.mdx:3: pack does not read "title=run.ts"'],
		[
			'```ts ref:call="api.call" ref:run="call("',
			'code.mdx:3: ref:run overlaps another mark at "call("',
		],
	])("fail the pack on a mark pack cannot place (%s)", async (fence, message) => {
		const { result } = await packMdx(dir, "code", `# Calls\n\n${fence}\n${CODE}\n\`\`\`\n`);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(message);
	});

	test("indent tabs 4 columns wide, 2 on a phone and paper, where a long line wraps under its own start, and light with the prose (#166, #154)", async () => {
		const output = await packedMdx(dir, "lines", PAGE);
		writeFileSync(output, readFileSync(output, "utf8").replace("</body>", LINES_CONTRACT));
		expect(await runPacked(output)).toEqual([]);
		expect(await runPacked(output, { media: "print", widths: [DESKTOP] })).toEqual([]);
	}, 30_000);

	test("keep every token class readable on the code and on lit code, in light and dark", async () => {
		const output = await packedMdx(dir, "contrast", PAGE);
		const low = await inPage(output, (cdp) => cdp.evaluate<string[]>(LOW_CONTRAST));
		expect(low).toEqual([]);
	}, 30_000);

	test("link marks only to a partner outside their listing: marks in one fence are one place (#154)", async () => {
		const output = await packedMdx(
			dir,
			"alone",
			'# Alone\n\n```ts ref:call="api.call"\napi.call(1);\napi.call(2);\n```\n',
		);
		const linked = await inPage(output, (cdp) =>
			cdp.evaluate<string[]>(
				`[...document.querySelectorAll("pre .is-linked, pre [tabindex]")].map((el) => el.outerHTML)`,
			),
		);
		expect(linked).toEqual([]);
	}, 30_000);
});
