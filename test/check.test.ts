import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTestPage } from "./browser.ts";
import { packAndRun, packHtml, pageContract, runCli, scratch } from "./support.ts";

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

test("check reports an id on two elements, in a page made elsewhere and after a --do step that writes one", async () => {
	const written = dir.write(
		"repeated.html",
		page("").replace(
			"</h1>",
			'</h1><details id="opt-O2"><summary>O2</summary></details><input type="checkbox" id="opt-O2">',
		),
	);
	const scripted = dir.write(
		"scripted.html",
		page(
			'document.body.insertAdjacentHTML("beforeend", \'<button id="add">Add</button><p id="note">One</p>\');\ndocument.getElementById("add").onclick = () => document.body.insertAdjacentHTML("beforeend", \'<p id="note">Two</p>\');',
		),
	);

	const [repeated, before, after] = await Promise.all([
		checkQuick(written),
		checkQuick(scripted),
		runCli([
			"check",
			scripted,
			"--quick",
			"--view",
			"none",
			"--out",
			dir.path("shots-do"),
			"--do",
			"click:#add",
		]),
	]);

	expect(repeated.code).toBe(1);
	expect(repeated.stdout).toContain(
		'the id "opt-O2" is on 2 elements (details#opt-O2, input#opt-O2): scripts, label for, #links and --do steps find only the first; give each its own id',
	);
	expect(before.code).toBe(0);
	expect(after.code).toBe(1);
	expect(after.stdout).toContain('the id "note" is on 2 elements (p#note, p#note)');
}, 60_000);

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

test("check warns about content cut off in a visibility:hidden panel whose child is visible, not in one wholly hidden", async () => {
	const panel = (id: string, child: string) =>
		`<div id="${id}" style="width:100px;overflow:hidden;visibility:hidden"><div style="width:300px${child}">wide content</div></div>`;
	const body = panel("ghost", ";visibility:visible") + panel("gone", "");
	const file = dir.write("hidden-panels.html", page("").replace("</h1>", `</h1>${body}`));

	const result = await checkQuick(file);

	expect(result.code).toBe(0);
	expect(result.stdout).toContain("div#ghost has content cut off: 300px of content in 100px");
	expect(result.stdout).not.toContain("div#gone");
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

test("check names a fix for tiny diagram text, and takes a diagram held at its readable width as scrolling by design", async () => {
	const sequence =
		"sequenceDiagram\n  Browser->>Server: GET /report\n  Server->>Cache: lookup\n  Server->>Database: query rows\n  Database-->>Browser: rows";
	// Held at 341 px: wider than the block's 326 px content box, narrower than its 358 px box with padding.
	const padded =
		"sequenceDiagram\n  participant B as Report generation service\n  participant S as Server\n  B->>S: request\n  S-->>B: response";
	const body = `<div id="hand"><svg viewBox="0 0 1200 100" width="100%"><text x="10" y="50" font-size="14">Hand-built label</text></svg></div>
<pre class="mermaid" id="held">${sequence}</pre><pre class="mermaid" id="squeezed">${sequence}</pre>
<pre class="mermaid" id="padded">${padded}</pre>`;
	const input = dir.write(
		"tiny.html",
		`<!doctype html><html><head>${VIEWPORT}<link rel="stylesheet" href="kit:theme.css"><style>#squeezed > svg { min-width: 0; }</style></head><body><main class="page"><h1>Probe</h1>${body}</main></body></html>`,
	);
	const output = dir.path("tiny.out.html");
	expect((await packHtml(input, output)).error).toBe("");

	const result = await checkQuick(output);

	expect(result.stdout).toMatch(
		/div#hand svg: .*keep it at min-width: \d+px inside a \.scroll block/,
	);
	expect(result.stdout).toContain("div#squeezed.mermaid svg: ");
	expect(result.stdout).toContain(
		"a page rule makes the diagram narrower than the min-width pack gives it",
	);
	expect(result.stdout).not.toContain("div#held");
	expect(result.stdout).not.toContain("div#padded");
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
		'figure#still.fig steps through 3 captions, but nothing else in it changes: show it whole without a Stepper, or mark its parts with data-step="<n>" (kit Stepper)',
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

/** Width and height of a PNG, read from its IHDR chunk. */
function pngSize(file: string): [number, number] {
	const bytes = readFileSync(file);
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** The colour ("r,g,b") of a PNG at each of `points`, read back through a canvas in Chrome. */
const pngColours = (file: string, points: Array<[number, number]>) =>
	withTestPage(async (cdp) => {
		const png = readFileSync(file).toString("base64");
		return cdp.evaluate<string[]>(
			`(async () => {
				const img = new Image();
				img.src = "data:image/png;base64,${png}";
				await img.decode();
				const ctx = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height }).getContext("2d");
				ctx.drawImage(img, 0, 0);
				return ${JSON.stringify(points)}.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).join());
			})()`,
			true,
		);
	});

test("check --do shot: saves a PNG of the element's box at each width, below the fold, taller than the viewport, and per match with @all", async () => {
	const body = `<style>@media (max-width: 500px) { #wide-only { display: none } }</style>
<p id="wide-only" style="width:200px;height:40px"></p>
<p class="gone" style="visibility:hidden;width:50px;height:50px"></p>
<details><summary>More</summary><p class="gone" style="width:50px;height:50px"></p></details>
<div class="gone" style="visibility:hidden;width:50px;height:50px"><span>hidden too</span></div>
<div id="ghost" style="visibility:hidden;width:80px;height:40px"><span style="visibility:visible">shown</span></div>
<div style="height:1300px"></div>
<div id="box" style="width:300px;height:200px;margin-left:40px;background:rgb(255,0,0)"></div>
<div id="tall" style="width:120px;height:1400px;background:rgb(0,0,255)"></div>
${[0, 1, 2].map((n) => `<p class="card" style="width:100px;height:${50 + n * 10}px;margin:0;background:rgb(0,128,0)"></p>`).join("")}`;
	const file = dir.write("shots.html", page("").replace("</h1>", `</h1>${body}`));
	const out = dir.path("element-shots");

	const result = await runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--out",
		out,
		"--do",
		"shot:#box",
		"--do",
		"shot:#tall",
		"--do",
		"shot:.card@all",
		"--do",
		"shot:#wide-only",
		"--do",
		"shot:.gone@all",
		"--do",
		"shot:#ghost",
	]);

	expect(result.code).toBe(0);
	for (const width of ["desktop", "narrow"]) {
		const box = join(out, `shot1-box-${width}.png`);
		expect(result.stdout).toContain(box);
		expect(pngSize(box)).toEqual([300, 200]);
		expect(
			new Set(
				await pngColours(box, [
					[1, 1],
					[298, 1],
					[1, 198],
					[298, 198],
				]),
			),
		).toEqual(new Set(["255,0,0"]));
		const tall = join(out, `shot2-tall-${width}.png`);
		expect(pngSize(tall)).toEqual([120, 1400]);
		expect(
			new Set(
				await pngColours(tall, [
					[1, 1],
					[118, 1398],
				]),
			),
		).toEqual(new Set(["0,0,255"]));
		expect([0, 1, 2].map((n) => pngSize(join(out, `shot3-card-${n}-${width}.png`)))).toEqual([
			[100, 50],
			[100, 60],
			[100, 70],
		]);
	}
	expect(existsSync(join(out, "shot4-wide-only-desktop.png"))).toBe(true);
	expect(existsSync(join(out, "shot4-wide-only-narrow.png"))).toBe(false);
	expect(result.stdout).toContain(
		"--do shot:#wide-only: no PNG at 390 px wide: its match is not shown",
	);
	for (const width of [1440, 390]) {
		expect(result.stdout).toContain(
			`--do shot:.gone@all: no PNG at ${width} px wide: match 0, 1, 2 is not shown`,
		);
	}
	expect(readdirSync(out).filter((png) => png.includes("gone"))).toEqual([]);
	for (const width of ["desktop", "narrow"]) {
		expect(pngSize(join(out, `shot6-ghost-${width}.png`))).toEqual([80, 40]);
	}
}, 60_000);

test("check --do shot: measures the element after the scroll that brings it into view has settled", async () => {
	const body = `<div id="spacer" style="height:1300px"></div>
<div id="grows" style="width:300px;height:100px;background:rgb(255,0,0)"></div><div style="height:2000px"></div>
<script>
addEventListener("scroll", () => {
	document.getElementById("spacer").style.height = "600px";
	document.getElementById("grows").style.height = "1200px";
}, { once: true });
${pageContract({})}
</script>`;

	const failures = await packAndRun(dir, "grows", page("").replace("</h1>", `</h1>${body}`), {
		steps: ["shot:#grows"],
	});

	expect(failures).toEqual([]);
	for (const width of [1440, 390]) {
		const png = dir.path(`grows.out-${width}-0.png`);
		expect(pngSize(png)).toEqual([300, 1200]);
		const corners = await pngColours(png, [
			[1, 1],
			[298, 1],
			[1, 1198],
			[298, 1198],
		]);
		expect(new Set(corners)).toEqual(new Set(["255,0,0"]));
	}
}, 60_000);

test("check waits for the timers a page sets at load and after a --do step, so what they throw is reported", async () => {
	const file = dir.write(
		"timers.html",
		`<!doctype html><html><head>${VIEWPORT}</head><body><h1>Timers</h1><button id="b">Later</button><script>
setTimeout(() => { throw new Error("thrown 700 ms after load"); }, 700);
document.getElementById("b").onclick = () => setTimeout(() => { throw new Error("thrown 400 ms after the click"); }, 400);
</script></body></html>`,
	);

	const result = await runCli([
		"check",
		file,
		"--quick",
		"--out",
		dir.path("shots"),
		"--do",
		"click:#b",
	]);

	expect(result.stdout).toContain("page error: Error: thrown 700 ms after load");
	expect(result.stdout).toContain("page error: Error: thrown 400 ms after the click");
}, 30_000);

test("check waits for a chart drawn late and names a visible one still not drawn at its deadline", async () => {
	// #never is shown on the desktop only, so one screen waits out the deadline. #late mounts 1.5 s after load, later than any
	// timer check tracks, so only the drawn signal makes check wait for it.
	const output = dir.path("undrawn.out.html");
	const packed = await packHtml(
		dir.write(
			"undrawn.html",
			`<!doctype html><html><head>${VIEWPORT}<link rel="stylesheet" href="kit:theme.css">
<style>@media (max-width: 600px) { #never { display: none; } }</style></head><body><main><h1>Charts</h1>
<div class="chart" id="late"></div><div class="chart" id="never"></div></main>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script>
<script>setTimeout(() => Charts.make(document.getElementById("late"), { xAxis: { data: ["a"] }, yAxis: {}, series: [{ type: "bar", data: [1] }] }), 1500);</script>
</body></html>`,
		),
		output,
	);
	expect(packed.error).toBe("");

	const result = await checkQuick(output);

	expect(result.stdout).toContain(
		"still waiting after 10 s for charts to be drawn: div#never.chart",
	);
	expect(result.stdout).not.toContain("#late");
	expect(result.code).toBe(1);
}, 40_000);

test("check refuses a --tag that is not a file name before it starts Chrome, so no PNG lands outside --out", async () => {
	const file = dir.write("tagged.html", page(""));
	const out = dir.path("tag-out");
	mkdirSync(out);
	// --quick names the desktop PNG <tag>-desktop.png in --out, which this tag would put beside --out, over this file.
	const beside = dir.path("escape-desktop.png");
	writeFileSync(beside, "before");

	const result = await runCli(["check", file, "--quick", "--tag", "../escape", "--out", out]);

	expect(result.code).toBe(2);
	expect(result.stderr).toBe(
		'error: --tag takes a name to add to file names, without a path separator, not "../escape"\n',
	);
	expect(readFileSync(beside, "utf8")).toBe("before");
	expect(readdirSync(out)).toEqual([]);
});
