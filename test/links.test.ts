import { afterAll, expect, test } from "bun:test";
import { packHtml, packMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const check = (file: string) =>
	runCli(["check", file, "--quick", "--view", "none", "--out", dir.path("shots")]);

test("pack and check warn on literal Markdown links in prose and list items, not code", async () => {
	const { result, output } = await packMdx(
		dir,
		"literal",
		`# Links

[x](docs/My Design Doc.md)

- [list](docs/Another Design.md)

\`[code](docs/My Design Doc.md)\`

<pre><code>[sample](docs/My Design Doc.md)</code></pre>

<svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>

[valid](<docs/My Design Doc.md>)

[encoded](docs/My%20Design%20Doc.md)
`,
	);
	expect(result.code).toBe(0);
	for (const text of ["[x](docs/My Design Doc.md)", "[list](docs/Another Design.md)"]) {
		expect(result.stdout).toContain(text);
	}
	expect(result.stdout).not.toContain("[code]");
	expect(result.stdout).not.toContain("[sample]");
	const checked = await check(output);
	expect(checked.code).toBe(0);
	expect(checked.stdout).toContain(
		"p.lede: Markdown link stayed literal: [x](docs/My Design Doc.md)",
	);
	expect(checked.stdout).toContain(
		"li: Markdown link stayed literal: [list](docs/Another Design.md)",
	);
	expect(checked.stdout).not.toContain("[code]");
	expect(checked.stdout).not.toContain("[sample]");
}, 30_000);

test("pack scans complete text nodes around self-closing SVG and nested code", async () => {
	const label = "x".repeat(2048);
	const text = `[${label}](target with spaces)`;
	const file = dir.write(
		"chunks.html",
		`<html><body><svg><path d="M0 0"/></svg><p>${text}</p><pre><code>[sample](literal)</code></pre></body></html>`,
	);
	const result = await packHtml(file, dir.path("chunks.out.html"));
	expect(result.error).toBe("");
	expect(result.warnings).toHaveLength(1);
	expect(result.warnings[0]).toContain(text);
});

test("check reports dead anchors as problems and missing relative files as warnings without fetching links", async () => {
	dir.write("existing file.html", "Existing");
	const file = dir.write(
		"links.html",
		`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<h1>Links</h1><p id="section">Target</p><p id="space id">Encoded target</p>
<a name="legacy"></a><a href="#legacy">Named anchor</a><input name="does-not-exist">
<section data-view="detail"></section><section data-view="static/one"></section>
<div id="plan" data-records=""></div><a href="#plan?view=table&sort=-labour">Records state</a>
<a href="#does-not-exist">Missing</a><a href="missing-document.html">Missing file</a><a href="bad%escape.html">Invalid escape</a>
<a href="#section">Valid</a><a href="#space%20id">Encoded</a><a href="#">Top</a><a href="#TOP">Top keyword</a>
<a href="#detail">View</a><a href="#detail/item?tab=one">Filled view</a>
<a href="#static/one?tab=one">Static view</a>
<a href="existing%20file.html?download=1#anything">Existing file</a>
<a href="https://example.invalid/no-fetch">External</a><a href="//example.invalid/no-fetch">External</a>
<a href="mailto:nobody@example.invalid">Mail</a>
<code>[sample](target with spaces)</code><script>const text = '[script](target with spaces)';</script>`,
	);
	const result = await check(file);
	expect(result.code).toBe(1);
	expect(result.stdout).toContain('missing in-page link target: href="#does-not-exist"');
	expect(result.stdout).toContain(
		'relative link target not found beside the page: href="missing-document.html"',
	);
	expect(result.stdout).toContain('href="bad%escape.html"');
	expect(result.stdout).toContain("1 problem, 2 warnings");
	expect(result.stdout).not.toContain("network request");
	expect(result.stdout).not.toContain("Markdown link stayed literal");
}, 30_000);

test("default check reports document links once, not again for each sampled control", async () => {
	const { output, result: packed } = await packMdx(
		dir,
		"controls",
		`import { Question } from "kit";

# Controls

[Dead](#absent)

<pre>[intentional](syntax)</pre>

<Question name="choice" legend="Pick" options={["One", "Two"]} />
`,
	);
	expect(packed.stderr).toBe("");
	expect(packed.code).toBe(0);
	const result = await runCli([
		"check",
		output,
		"--view",
		"none",
		"--out",
		dir.path("controls-shots"),
	]);
	expect(result.code).toBe(1);
	expect(result.stdout.match(/missing in-page link target/g)).toHaveLength(4);
	expect(result.stdout).not.toContain("control ");
	expect(result.stdout).toContain("1 problem,");
}, 30_000);

test("check diagnoses literal text in a page packed elsewhere with a locator", async () => {
	const file = dir.write(
		"elsewhere.html",
		`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<h1>Links</h1><ul><li id="broken">[outside](target with spaces)</li></ul>`,
	);
	const result = await check(file);
	expect(result.code).toBe(0);
	expect(result.stdout).toContain(
		"li#broken: Markdown link stayed literal: [outside](target with spaces)",
	);
	expect(result.stdout).toContain("0 problems, 1 warning");
}, 30_000);
