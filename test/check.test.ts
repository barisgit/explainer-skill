import { afterAll, expect, test } from "bun:test";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const page = (script: string) =>
	`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Probe</h1><script>${script}</script></body></html>`;
const checkQuick = (file: string) =>
	runCli(["check", file, "--quick", "--view", "none", "--out", dir.path("shots")]);

test("check reports a page error as a problem with where it was thrown, and exits 1", async () => {
	const file = dir.write(
		"throws.html",
		page(
			'function inner() { throw new Error("boom from the page"); }\nfunction outer() { inner(); }\nouter();',
		),
	);

	const result = await checkQuick(file);

	expect(result.code).toBe(1);
	expect(result.stdout).toContain("FAIL");
	expect(result.stdout).toContain("page error: Error: boom from the page (at inner 1:");
	expect(result.stdout).toMatch(/, outer 2:\d+/);
}, 30_000);

test("check exits 0 for a page that only shows kit: in text, which is not an unpacked page", async () => {
	const sample = `<pre>&lt;link rel="stylesheet" href="kit:theme.css"&gt;</pre>`;
	const file = dir.write(
		"kit-text.html",
		page(`document.title = '<script src="kit:plot.js">';`).replace("</h1>", `</h1>${sample}`),
	);

	const result = await checkQuick(file);

	expect(result.code).toBe(0);
}, 30_000);

test("check names a first screen that is a list of in-page links, and keeps the hint for plain prose", async () => {
	const questions = `<ol>${[1, 2, 3].map((n) => `<li><a href="#q${n}">Question ${n}?</a></li>`).join("")}</ol>`;
	const withMap = dir.write("map.html", page("").replace("</h1>", `</h1>${questions}`));
	const prose = dir.write("prose.html", page("").replace("</h1>", "</h1><p>Only words here.</p>"));

	const [map, plain] = await Promise.all(
		[withMap, prose].map((file) =>
			runCli(["check", file, "--view", "none", "--out", dir.path("first")]),
		),
	);

	expect(map?.stdout).toContain("text map: 3 in-page links");
	expect(map?.stdout).not.toContain("no figure in view");
	expect(plain?.stdout).toContain("no figure in view");
}, 60_000);

test("check on a page that still has kit: references says to run pack first (exit 2)", async () => {
	const file = dir.write(
		"unpacked.html",
		`<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body><h1>Unpacked</h1></body></html>`,
	);

	const result = await runCli(["check", file, "--quick", "--out", dir.path("unpacked")]);

	expect(result.code).toBe(2);
	expect(result.stderr).toContain("kit:theme.css");
	expect(result.stderr).toContain("pack");
}, 30_000);

test("check --do focus:<x,y> is a usage error, not a silent no-op", async () => {
	const file = dir.write("clean-focus.html", page(""));

	const result = await runCli(["check", file, "--quick", "--do", "focus:100,200"]);

	expect(result.code).toBe(2);
	expect(result.stderr).toContain("focus");
	expect(result.stderr).toContain("click:<x,y>");
}, 30_000);

test("check warns about content cut off inside an overflow:hidden panel, but not about ellipsis truncation", async () => {
	const body = `<div id="panel" style="width:100px;overflow:hidden"><div style="width:300px">wide content</div></div><p id="title" style="width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">a long title that is truncated on purpose</p>`;
	const file = dir.write("clipped.html", page("").replace("</h1>", `</h1>${body}`));

	const result = await checkQuick(file);

	expect(result.code).toBe(0);
	expect(result.stdout).toContain("div#panel has content cut off: 300px of content in 100px");
	expect(result.stdout).not.toContain("p#title");
}, 30_000);

test("check ignores content inside a closed <details>: no cut-off warnings and no text map from hidden links", async () => {
	const hiddenBoxes = Array.from(
		{ length: 7 },
		(_, n) =>
			`<div id="hidden${n}" style="width:100px;overflow:hidden"><div style="width:300px">wide</div></div>`,
	).join("");
	const links = `<ol>${[1, 2, 3].map((n) => `<li><a href="#q${n}">Question ${n}?</a></li>`).join("")}</ol>`;
	const body = `<details><summary>More</summary>${links}${hiddenBoxes}</details><div id="visible" style="width:100px;overflow:hidden"><div style="width:300px">wide</div></div>`;
	const file = dir.write("folded.html", page("").replace("</h1>", `</h1>${body}`));

	const result = await runCli(["check", file, "--view", "none", "--out", dir.path("folded")]);

	expect(result.stdout).toContain("div#visible has content cut off");
	expect(result.stdout).not.toContain("div#hidden");
	expect(result.stdout).toContain("no figure in view");
}, 30_000);

test("check does not warn about a data table that scrolls sideways, but does about other sideways scrollers", async () => {
	const body = `<div id="grid" style="width:200px;overflow-x:auto"><table style="width:600px"><tr><td>wide table</td></tr></table></div><div id="strip" style="width:200px;overflow-x:auto"><div style="width:600px">wide strip</div></div>`;
	const file = dir.write("scrolls.html", page("").replace("</h1>", `</h1>${body}`));

	const result = await checkQuick(file);

	expect(result.stdout).toContain("scrolls sideways: div#strip");
	expect(result.stdout).not.toContain("div#grid");
}, 30_000);
