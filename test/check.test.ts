import { afterAll, expect, test } from "bun:test";
import { packHtml, runCli, scratch } from "./support.ts";

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
	expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("Verdict: FAIL, 1 problem, 0 warnings.");
}, 30_000);

const tall = (script: string) =>
	page(script).replace(
		"</h1>",
		`</h1>${[1, 2, 3, 4, 5].map((n) => `<section id="s${n}" style="height:1200px">Section ${n}</section>`).join("")}`,
	);

test("check scrolls the page, so an observer or scroll handler that throws only after scrolling is a problem", async () => {
	const observer = dir.write(
		"observer.html",
		tall(
			'const spy = (entries) => { for (const e of entries) if (e.isIntersecting && e.target.id === "s4") document.querySelector("#no-menu-link").setAttribute("aria-current", "true"); };\nconst io = new IntersectionObserver(spy);\ndocument.querySelectorAll("section").forEach((s) => io.observe(s));',
		),
	);
	const listener = dir.write(
		"listener.html",
		tall(
			'addEventListener("scroll", () => { if (scrollY > 2000) throw new Error("late scroll"); });',
		),
	);

	const [io, scroll] = await Promise.all([observer, listener].map(checkQuick));

	expect(io?.code).toBe(1);
	expect(io?.stdout).toMatch(/page error: TypeError: .*setAttribute.* \(at spy \d+:\d+/);
	expect(scroll?.code).toBe(1);
	expect(scroll?.stdout).toMatch(/page error: Error: late scroll \(at <anonymous> \d+:\d+/);
}, 60_000);

test("check exits 0 for a page that only shows kit: in text, which is not an unpacked page", async () => {
	const sample = `<pre>&lt;link rel="stylesheet" href="kit:theme.css"&gt;</pre>`;
	const file = dir.write(
		"kit-text.html",
		page(`document.title = '<script src="kit:plot.js">';`).replace("</h1>", `</h1>${sample}`),
	);

	const result = await checkQuick(file);

	expect(result.code).toBe(0);
	expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("Verdict: ok, 0 problems, 0 warnings.");
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

test("check starts every load with empty page storage, so neither one shot's state nor what the old page writes while leaving reaches the next", async () => {
	const file = dir.write(
		"storage.html",
		page(
			`localStorage.visits = Number(localStorage.visits ?? 0) + 1;
addEventListener("pagehide", () => { localStorage.leftBehind = "1"; });
setTimeout(() => { if (localStorage.visits !== "1" || localStorage.leftBehind) throw new Error("storage leaked: visit " + localStorage.visits + (localStorage.leftBehind ? ", written while leaving" : "")); }, 300);`,
		),
	);

	const result = await runCli(["check", file, "--view", "none", "--out", dir.path("storage")]);

	expect(result.stdout).not.toContain("storage leaked");
	expect(result.code).toBe(0);
}, 60_000);

test("check --do reload loads the page a second time in the same tab", async () => {
	const file = dir.write(
		"reload.html",
		page(
			`sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;
if (sessionStorage.loads === "2") throw new Error("second load");`,
		),
	);

	const plain = await checkQuick(file);
	const reloaded = await runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--do",
		"reload",
		"--out",
		dir.path("reload"),
	]);

	expect(plain.code).toBe(0);
	expect(reloaded.code).toBe(1);
	expect(reloaded.stdout).toContain("page error: Error: second load");
}, 60_000);

test("check warns about a stepper whose steps change only its captions, not one that redraws or marks its parts", async () => {
	const captions = "<ol data-captions><li>One</li><li>Two</li><li>Three</li></ol>";
	const source = dir.write(
		"steppers.html",
		`<!doctype html><html><head>${VIEWPORT}<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Steppers</h1>
<figure class="fig" id="still" data-stepper><p>A picture that never changes.</p>${captions}</figure>
<figure class="fig" id="redrawn" data-stepper><p id="count"></p>${captions}</figure>
<figure class="fig" id="marked" data-stepper><p data-step="2">Appears at two.</p>${captions}</figure>
<script>document.querySelector("#redrawn").addEventListener("stepchange", (e) => { document.querySelector("#count").textContent = "Step " + e.detail.step; });</script>
<script src="kit:steps.js"></script></body></html>`,
	);
	const packed = dir.path("steppers.out.html");
	expect((await packHtml(source, packed)).error).toBe("");

	const result = await checkQuick(packed);

	expect(result.code).toBe(0);
	expect(result.stdout).toContain(
		'figure#still.fig steps through 3 captions, but nothing else in it changes: show it whole without data-stepper, or mark its parts with data-step="<n>" (kit steps.js)',
	);
	expect(result.stdout).not.toContain("figure#redrawn");
	expect(result.stdout).not.toContain("figure#marked");
}, 30_000);

test("check stops stepping a stepper once it changes, and says so when its time runs out before that", async () => {
	const captions = `<ol data-captions>${"<li>Step</li>".repeat(300)}</ol>`;
	const source = dir.write(
		"long-steppers.html",
		`<!doctype html><html><head>${VIEWPORT}<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Steppers</h1>
<figure class="fig" id="still" data-stepper><p>Never changes.</p>${captions}</figure>
<figure class="fig" id="redrawn" data-stepper><p id="count"></p>${captions}</figure>
<script>document.querySelector("#redrawn").addEventListener("stepchange", (e) => { document.querySelector("#count").textContent = "Step " + e.detail.step; });</script>
<script src="kit:steps.js"></script></body></html>`,
	);
	const packed = dir.path("long-steppers.out.html");
	expect((await packHtml(source, packed)).error).toBe("");
	const started = performance.now();

	const result = await checkQuick(packed);

	expect(performance.now() - started).toBeLessThan(15_000);
	expect(result.code).toBe(0);
	expect(result.stdout).toMatch(
		/figure#still\.fig was not fully checked: its first \d+ of 300 steps change only the captions, and check stops after 40 steps or 3 s: step through the rest by hand/,
	);
	expect(result.stdout).not.toContain("steps through 300 captions");
	expect(result.stdout).not.toContain("figure#redrawn");
}, 60_000);
