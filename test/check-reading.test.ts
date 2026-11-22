import { afterAll, expect, test } from "bun:test";
import { packedMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const PAGE = `# Reading load

${words(10)}

## Short

${words(160)}

## Same

${words(200)}

## Same

${words(200)}

## Table beside prose

${words(200)}

| Option | Cost |
|---|---|
| A | ${words(40)} |

## Hidden prose

<details><summary>More</summary>${words(300)}</details>
`;

const warned = (stdout: string) =>
	stdout.split("\n").filter((line) => line.includes("and no figure, table, diagram or code"));

test("check warns about a section of more than about 150 bare words and no figure, table or diagram; it passes", async () => {
	const page = await packedMdx(dir, "reading", PAGE);
	const { code, stdout } = await runCli([
		"check",
		page,
		"--view",
		"none",
		"--out",
		dir.path("out"),
	]);

	expect(code).toBe(0);
	// 160 words stay under the limit, 200 with a table beside them are not a wall, and identical headings keep their own warnings.
	expect(warned(stdout).map((w) => w.trim().slice(0, 36))).toEqual([
		'section 2 "Same" has 200 words and n',
		'section 3 "Same" has 200 words and n',
	]);
	expect(stdout).toContain("(more than about 150 read as a wall)");
	expect(stdout).toContain("Reading load (light desktop overview, on arrival):");
	expect(stdout).toContain("bare words per section: 160, 200, 200, 200, 1");
}, 90_000);

test("check counts a table's words outside a section's prose, and a closed fold's not at all", async () => {
	const page = await packedMdx(dir, "json", PAGE);
	const { stdout } = await runCli([
		"check",
		page,
		"--view",
		"none",
		"--quick",
		"--json",
		"--out",
		dir.path("json"),
	]);
	const { reading } = JSON.parse(stdout).shots[0];

	expect(reading.bare.map((s: { words: number; visual: boolean }) => [s.words, s.visual])).toEqual([
		[160, false],
		[200, false],
		[200, false],
		[200, true],
		[1, false],
	]);
	// 160 + 200 + 200 + 200 + 40 table + 8 table, heading and masthead words + the fold's summary; not its 300.
	expect(reading.loadWords).toBeGreaterThan(800);
	expect(reading.loadWords).toBeLessThan(830);
}, 90_000);

test("check counts the first screen's words apart from the words below it", async () => {
	const page = await packedMdx(
		dir,
		"first",
		`# Reading load

## Top

${words(20)}

<div style={{ height: "3000px" }} />

## Below

${words(100)}
`,
	);
	const { stdout } = await runCli([
		"check",
		page,
		"--view",
		"none",
		"--quick",
		"--json",
		"--out",
		dir.path("first"),
	]);
	const { reading } = JSON.parse(stdout).shots[0];

	// Top's heading and 20 words, the h1's two words; Below's heading and 100 words are under the fold.
	expect(reading.firstScreenWords).toBeGreaterThanOrEqual(23);
	expect(reading.firstScreenWords).toBeLessThanOrEqual(30);
	expect(reading.loadWords).toBeGreaterThanOrEqual(123);
	expect(reading.loadWords).toBeLessThanOrEqual(130);
}, 90_000);

const crossing = (stdout: string) => JSON.parse(stdout).shots[0].reading;

test("check counts only the share of a paragraph that crosses the fold on the first screen", async () => {
	const page = await packedMdx(
		dir,
		"fold",
		`# Reading load

<div style={{ height: "600px" }} />

${words(300)}
`,
	);
	const { stdout } = await runCli([
		"check",
		page,
		"--view",
		"none",
		"--quick",
		"--json",
		"--out",
		dir.path("fold"),
	]);
	const { firstScreenWords, loadWords } = crossing(stdout);

	expect(loadWords).toBe(302);
	expect(firstScreenWords).toBeGreaterThan(2);
	expect(firstScreenWords).toBeLessThan(302);
}, 90_000);

test("check counts the prose of a band, a figure wrapper without evidence, and leaves out a Question's choices and its explanation before a choice", async () => {
	const page = await packedMdx(
		dir,
		"prose",
		`import { Question } from "kit";

# Reading load

<section class="band">

## Band

${words(100)}

</section>

## Wrapped

<div class="fig">${words(60)}</div>

## Explained

<Question name="q" legend="Which one?" options={["a", "b"]} answer="a">${words(80)}</Question>
`,
	);
	const { stdout } = await runCli([
		"check",
		page,
		"--view",
		"none",
		"--quick",
		"--json",
		"--out",
		dir.path("prose"),
	]);

	expect(
		crossing(stdout).bare.map((s: { words: number; visual: boolean }) => [s.words, s.visual]),
	).toEqual([
		[100, false],
		[60, false],
		// The explanation shows once a choice is made; on arrival neither it nor the choices are words.
		[0, false],
	]);
}, 90_000);
