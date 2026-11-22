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

	test("runs a spliced part's code once: the part is no module of its own any more", async () => {
		const page = await packedMdx(
			dir,
			"once",
			`import P from "./parts/count.mdx";\n\n# T\n\n<P />\n`,
			{
				"parts/count.mdx": `export const calls = (globalThis.partCalls = (globalThis.partCalls ?? 0) + 1);\n\n## A\n\nCalled {globalThis.partCalls} time(s).\n`,
			},
		);
		expect(readFileSync(page, "utf8")).toContain("Called 1 time(s).");
	}, 30_000);

	test("joins the same thing bound twice once: one import written two ways, a nested part spliced by two chapters", async () => {
		const page = await packedMdx(
			dir,
			"same",
			`import { default as A } from "./parts/a.mdx";\nimport B from "./parts/b.mdx";\n\n# T\n\n<A />\n\n<B />\n`,
			{
				"parts/a.mdx": `import V from "./v.ts";\nimport N from "./n.mdx";\n\n## A {V}\n\n<N />\n`,
				"parts/b.mdx": `import { default as V } from "./v.ts";\nimport N from "./n.mdx";\n\n## B {V}\n\n<N />\n`,
				"parts/n.mdx": `export const shared = 3;\n\n### Shared {shared}\n`,
				"parts/v.ts": "export default 7;\n",
			},
		);
		const main = mainOf(page);
		expect(main?.match(/<section>\s*<h2>[AB] 7/g)).toHaveLength(2);
		expect(main?.match(/<h3[^>]*>Shared 3/g)).toHaveLength(2);
	}, 30_000);
});

describe("a part pack cannot join to the page", () => {
	test.each([
		[
			"props",
			`<One open />`,
			{},
			"has props or children; write <One /> alone to lay it out as part of the page",
		],
		[
			"layout",
			`<One />`,
			{ "parts/one.mdx": `export { Wrap as default } from "./wrap.tsx";\n\n## A\n` },
			"has a layout (export default); wrap its content in a component it imports instead",
		],
		[
			"import()",
			`<One />`,
			{ "parts/one.mdx": `export const data = await import("./values.ts");\n\n## A\n` },
			"loads files relative to itself (import() or import.meta); import them at its top instead",
		],
	])(
		"a part with %s stays a component, and pack warns that its headings make no sections",
		async (name, use, files, why) => {
			const { result } = await packMdx(
				dir,
				"kept",
				`import One from "./parts/one.mdx";\n\n# T\n\n${use}\n`,
				{
					...PARTS,
					"parts/wrap.tsx": "export const Wrap = (p: { children?: unknown }) => p.children;\n",
					...files,
				},
			);
			expect(result.code, name).toBe(0);
			expect(result.stdout).toContain(
				`kept.mdx: <One> stays a component, so its # and ## headings make no masthead, sections or contents entries: it ${why}`,
			);
		},
		30_000,
	);

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

	test("a reference label two files define differently fails, naming both", async () => {
		const { result } = await packMdx(
			dir,
			"labels",
			`import P from "./parts/p.mdx";\n\n# T\n\nSee [doc].\n\n[doc]: https://a.example\n\n<P />\n`,
			{ "parts/p.mdx": "## A\n\nSee [doc].\n\n[doc]: https://b.example\n" },
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toMatch(
			/parts\/p\.mdx: \[doc\] is bound in \S*labels\.mdx too, to something else/,
		);
	}, 30_000);
});

describe("what two of a page's files share", () => {
	test("a label one file defines twice keeps its first, as Markdown does; a part's new.target is no relative load", async () => {
		const page = await packedMdx(
			dir,
			"twice",
			`import P from "./parts/p.mdx";\n\n# T\n\nSee [doc].\n\n[doc]: https://a.example\n[doc]: https://b.example\n\n<P />\n`,
			{ "parts/p.mdx": "export function F() { return new.target ? 1 : 2; }\n\n## A {F()}\n" },
		);
		const main = mainOf(page);
		expect(main).toContain('href="https://a.example"');
		expect(main).toMatch(/<section>\s*<h2>A 2/);
	}, 30_000);

	test("a part laid out in one place and used as a component in another fails, since its code would run twice", async () => {
		const { result } = await packMdx(
			dir,
			"mixed",
			`import P from "./parts/p.mdx";\n\n# T\n\n<P />\n\n<P kept />\n`,
			{
				"parts/p.mdx": "## A\n",
			},
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			"mixed.mdx: <P> is laid out as part of the page in one place and used as a component in another",
		);
	}, 30_000);

	test("a part that cannot be read fails naming the file that imports it", async () => {
		const { result } = await packMdx(
			dir,
			"missing",
			`import P from "./parts/none.mdx";\n\n# T\n\n<P />\n`,
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toMatch(
			/missing\.mdx: <P> imports \S*parts\/none\.mdx, which cannot be read/,
		);
		expect(result.stderr).not.toContain("    at ");
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
		[
			"in an export",
			`import { s10_Mean } from "./mean.tsx";\n\nexport const Figure = () => <s10_Mean />;\n\n# T\n\n<Figure />\n`,
			{},
			"lower.mdx:3",
		],
	])(
		"fails %s, naming where and how to fix it",
		async (_where, page, files, at) => {
			const { result } = await packMdx(dir, "lower", page, { "mean.tsx": TSX, ...files });
			expect(result.code).not.toBe(0);
			expect(result.stderr).toContain(
				`${at}: <s10_Mean> starts with a small letter, so MDX writes it as an HTML element and the imported s10_Mean never draws: import it under a name with a capital letter, such as S10_Mean, and write <S10_Mean />`,
			);
		},
		30_000,
	);
});
