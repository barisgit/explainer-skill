import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pageContract, runCli, runPacked, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A study page's math: inline formulas in a sentence, an aligned derivation, an equation wider than a phone and a formula sheet. */
const PAGE = `# The µA723 in formulas

The divider sets the output, $V_{out} = V_{ref}\\left(1 + \\frac{R_1}{R_2}\\right)$, and the sense resistor the limit, $I_{sc} = \\frac{V_{BE}}{R_{sc}}$.

## Heat

A long chain stays one piece in a sentence: $a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 = b$ while $a_1 + b$ is short.

$$
\\begin{aligned} V_{out} &= V_{ref}\\,\\frac{R_1 + R_2}{R_2} \\\\ &\\approx 16.6\\,\\text{V} \\end{aligned}
$$

$$
P_{diss} = (V_{in} - V_{out})\\,I_{load} + V_{in}\\,I_q = (24\\,\\text{V} - 15\\,\\text{V})\\cdot 0.15\\,\\text{A} + 24\\,\\text{V}\\cdot 2.3\\,\\text{mA} = 1.405\\,\\text{W}
$$

## Formula sheet

| Quantity | Formula |
|---|---|
| Dissipation | $P_{diss} = (V_{in} - V_{out})\\,I_{load} + V_{in}\\,I_q = 1.35\\,\\text{W} + 0.055\\,\\text{W}$ |
`;

/** Packs `source` as `<name>.mdx` with `files` beside it; returns the CLI result and the output path. */
async function packMdx(name: string, source: string, files: Record<string, string> = {}) {
	for (const [file, text] of Object.entries(files)) {
		dir.write(file, text);
	}
	const output = dir.path(`${name}.out.html`);
	return { result: await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]), output };
}

describe("TeX math in an .mdx page", () => {
	test("renders to MathML in pack: no script ships, and only a page with math carries the math stylesheet", async () => {
		const math = await packMdx("math", PAGE);
		expect(math.result.stderr).toBe("");
		const html = readFileSync(math.output, "utf8");
		expect(html).not.toContain("<script");
		expect(html).toMatch(/, <math><mrow><msub><mi>V<\/mi>/);
		expect(html).toContain('<div class="math"><math display="block" class="tml-display"');
		expect(html).toContain("<mtable");
		expect(html).toContain("font-family: 'Temml'");

		const plain = await packMdx("plain", "# No math\n\nA price of \\$5 and \\$6 is text.\n");
		expect(plain.result.stderr).toBe("");
		const text = readFileSync(plain.output, "utf8");
		expect(text).not.toMatch(/<math|Temml|tml-/);
	});

	test.each([
		["costs $5 and $6 a month", "$5 and $"],
		["from $5-$10 a month", "$5-$"],
	])(
		"two dollar amounts in prose (%s) fail the pack instead of turning into math",
		async (prose, span) => {
			const { result } = await packMdx("dollars", `# Prices\n\nIt ${prose}.\n`);
			expect(result.code).not.toBe(0);
			expect(result.stderr).toContain(`dollars.mdx:3:`);
			expect(result.stderr).toContain(`${span} reads as math between two dollar signs`);
		},
	);

	test("a TeX error fails the pack at the formula's line", async () => {
		const { result } = await packMdx(
			"broken",
			"# Broken\n\nFine text.\n\nThe ratio $\\frac{a$ is wrong.\n",
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toMatch(/broken\.mdx:5:\d+: .*\\frac\{a/);
	});

	test("inline math stays whole, display math scrolls inside the column, and both take the text colour", async () => {
		const script = pageContract({
			// Squeezed into a column narrower than the chain, a formula that could break would grow a second line.
			"inline math stays one line in a narrow column": `(() => { const [long, short] = [...document.querySelectorAll("p math")].slice(2); long.parentElement.style.width = "6rem"; const one = long.getBoundingClientRect().height <= short.getBoundingClientRect().height + 1; long.parentElement.style.width = ""; return one; })()`,
			"a wide equation scrolls in its own box on phones": `[...document.querySelectorAll(".math")].some((box) => box.scrollWidth > box.clientWidth) === (innerWidth < 640)`,
			"the page itself never scrolls sideways": `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
			"math is in the text colour": `getComputedStyle(document.querySelector("math")).color === getComputedStyle(document.querySelector("p")).color`,
		});
		const { result, output } = await packMdx("run", `${PAGE}\n<script src="math.js"></script>\n`, {
			"math.js": script,
		});
		expect(result.code).toBe(0);
		expect(await runPacked(output)).toEqual([]);
	}, 30_000);

	test("check reports no overflow and no sideways scroll for a long equation at 390 px", async () => {
		const { output } = await packMdx("checked", PAGE);
		const checked = await runCli(["check", output, "--out", dir.path("checked")]);
		expect(checked.stdout).not.toMatch(/overflow|scrolls sideways/);
		expect(checked.code).toBe(0);
	}, 60_000);
});
