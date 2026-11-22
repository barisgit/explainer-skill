import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { packedMdx, packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The packed page's <main>, which holds every element the layout made. */
const mainOf = (file: string) => /<main[\s\S]*<\/main>/.exec(readFileSync(file, "utf8"))?.[0];

const VALUES = `export const PEAK = 42;\nexport const rows = ["a", "b"];\n`;

/** The page's parts: its head, and a chapter in parts/ that imports a model beside it and another part. */
const PARTS = {
	"parts/head.mdx": `# Peak load is {PEAK} kW\n\nWhat it rests on.\n`,
	"parts/one.mdx": `import { PEAK, rows } from "./values.ts";\nimport Two from "./two.mdx";\n\n## First chapter\n\nThe peak is {PEAK}, over {rows.length} rows.\n\n### A topic\n\nText.\n\n<Two />\n`,
	"parts/two.mdx": `import { Table } from "kit";\n\n### Another topic\n\n| Name | N |\n|---|---:|\n| x | 1 |\n\n## Second chapter\n\nCosts $5 or more.\n`,
	"parts/values.ts": VALUES,
};

describe("a page made of .mdx parts", () => {
	test("is laid out as the same page written in one file: masthead, a section per ##, its imports joined", async () => {
		const split = await packedMdx(
			dir,
			"split",
			`---\ncontents: true\n---\nimport { PEAK } from "./parts/values.ts";\nimport { Table } from "kit";\nimport Head from "./parts/head.mdx";\nimport One from "./parts/one.mdx";\n\n<Head />\n\n<One />\n`,
			PARTS,
		);
		const whole = await packedMdx(
			dir,
			"whole",
			`---\ncontents: true\n---\nimport { PEAK, rows } from "./parts/values.ts";\nimport { Table } from "kit";\n\n# Peak load is {PEAK} kW\n\nWhat it rests on.\n\n## First chapter\n\nThe peak is {PEAK}, over {rows.length} rows.\n\n### A topic\n\nText.\n\n### Another topic\n\n| Name | N |\n|---|---:|\n| x | 1 |\n\n## Second chapter\n\nCosts $5 or more.\n`,
		);
		const main = mainOf(split);
		expect(main).toContain('<header class="masthead"><h1>Peak load is 42 kW</h1><p class="lede">');
		expect(main?.match(/<section>\s*<h2>/g)).toHaveLength(2);
		expect(main).toBe(mainOf(whole));
	}, 30_000);

	test("a part given props stays a component, and pack warns that its headings make no sections", async () => {
		const { result } = await packMdx(
			dir,
			"props",
			`import One from "./parts/one.mdx";\n\n# T\n\n<One open />\n`,
			PARTS,
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(
			/warning: \S*props\.mdx: <One> has props or children, so it stays a component and its # and ## headings make no masthead, sections or contents entries; write <One \/> alone to lay it out as part of the page/,
		);
	}, 30_000);

	test("a name two files bind to different things fails, naming both", async () => {
		const { result } = await packMdx(
			dir,
			"clash",
			`import { rows } from "./other.ts";\nimport One from "./parts/one.mdx";\n\n# T {rows}\n\n<One />\n`,
			{ ...PARTS, "other.ts": "export const rows = 1;\n" },
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toMatch(
			/parts\/one\.mdx: rows is bound in \S*clash\.mdx too, to something else; a part's names join the page's, so rename one of them/,
		);
	}, 30_000);

	test("an error in a part names the part's file and line", async () => {
		const { result } = await packMdx(
			dir,
			"part-error",
			`import Bad from "./parts/bad.mdx";\n\n# T\n\nText.\n\n<Bad />\n`,
			{ "parts/bad.mdx": "## A\n\nText.\n\nIt costs $5 and $6.\n" },
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("parts/bad.mdx:5:10: $5 and $ reads as math");
	}, 30_000);
});

describe("a component imported under a lowercase name", () => {
	const TSX = `export function s10_Mean() { return <svg />; }\n`;
	test.each([
		[
			"in the page",
			`import { s10_Mean } from "./mean.tsx";\n\n# T\n\n<s10_Mean />\n`,
			{},
			"lower.mdx:5",
		],
		[
			"in an expression",
			`import { s10_Mean } from "./mean.tsx";\n\n# T\n\n{true && <s10_Mean />}\n`,
			{},
			"lower.mdx:5",
		],
		[
			"in a part",
			`import P from "./parts/p.mdx";\n\n# T\n\n<P />\n`,
			{ "parts/p.mdx": `import { s10_Mean } from "../mean.tsx";\n\n## A\n\n<s10_Mean />\n` },
			"parts/p.mdx:5",
		],
	])(
		"fails %s, naming where and how to fix it",
		async (_where, page, files, at) => {
			const { result } = await packMdx(dir, "lower", page, { "mean.tsx": TSX, ...files });
			expect(result.code).not.toBe(0);
			expect(result.stderr).toContain(
				`${at}: <s10_Mean> starts with a small letter, so MDX writes it as an HTML element and the imported s10_Mean never draws: import it under a capitalised name (import { s10_Mean as S10_Mean }) and write <S10_Mean />`,
			);
		},
		30_000,
	);
});
