import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	packAndRun,
	packHtml,
	packMdx,
	pageContract,
	runCli,
	SETTLED,
	scratch,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The class of each SVG part a, b and c, joined: "is-on" once it has appeared, "is-now" on a step it lists. */
const PART_CLASSES = `["a", "b", "c"].map((id) => document.getElementById(id).getAttribute("class") ?? "").join()`;

const PAGE = (
	checks: string,
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Steps</h1>
<figure class="fig" id="s" data-stepper data-start="1">
<svg viewBox="0 0 90 20" width="270"><rect id="a" data-step="1" width="20" height="20"/><rect id="b" data-step="2 3" x="35" width="20" height="20"/><rect id="c" data-step="3" x="70" width="20" height="20"/></svg>
<ol data-captions><li>one</li><li>two</li><li>three</li></ol></figure>
<figure class="fig" data-stepper data-labels="Nazaj"><p data-step="1">x</p><p data-step="2">y</p></figure>
<script src="kit:steps.js"></script>
<script>
const heard = [];
document.getElementById("s").addEventListener("stepchange", (e) => heard.push(e.detail.step));
document.addEventListener("DOMContentLoaded", () => document.getElementById("s").addEventListener("stepchange", (e) => heard.push(\`dcl\${e.detail.step}\`)));
${checks}</script></body></html>`;

const CHECKS = pageContract({
	"the opening step reaches listeners the page adds in its scripts or in DOMContentLoaded handlers":
		'heard.join() === "1,dcl1"',
	"on the opening step only the part listing step 1 is shown and lit": `${PART_CLASSES} === "is-on is-now,,"`,
	"data-go buttons step: an earlier part stays shown, unlit, and a part listing steps 2 and 3 appears at 2": `(document.querySelector('[data-go="1"]').click(), heard.filter(Number).at(-1) === 2 && ${PART_CLASSES} === "is-on,is-on is-now,")`,
});

test("a stepper over hand-built SVG parts", async () => {
	expect(await packAndRun(dir, "steps", PAGE(CHECKS))).toEqual([]);
}, 30_000);

test("print shows every stepper part and caption, even on the opening step", async () => {
	const checks = pageContract({
		"all SVG and HTML parts print at full opacity":
			'[...document.querySelectorAll("[data-step]")].every((part) => getComputedStyle(part).opacity === "1")',
		"every caption prints as a list item":
			'[...document.querySelectorAll("[data-captions] > li")].every((caption) => getComputedStyle(caption).display === "list-item")',
	});
	expect(await packAndRun(dir, "steps-print", PAGE(checks), { media: "print" })).toEqual([]);
}, 30_000);

test("a stepper that still has v0.7.0's data-labels hears it through check", async () => {
	const input = dir.write("legacy.html", PAGE(""));
	const output = dir.path("legacy.out.html");

	const packed = await packHtml(input, output);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);

	expect(packed.error).toBe("");
	expect(checked.stdout).toContain("kit:steps.js: data-labels is no longer read");
	expect(checked.code).toBe(0);
}, 60_000);

/**
 * A stepper over a sequence diagram whose captions name refs: the messages m1 and m2 inside it and a code token far outside it,
 * which steps 1 and 3 light.
 */
const SEQUENCE = (
	checks: string,
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Sequence</h1>
<figure class="fig" id="seq" data-stepper data-start="1">
<pre class="mermaid">sequenceDiagram
  participant c as Client
  participant s as Server
  c->>s: request
  s->>c: reply</pre>
<ol data-captions><li data-refs="m1 call">The client asks.</li><li data-refs="m2">The server answers.</li><li data-refs="call">The call returns.</li></ol></figure>
<p>The client calls <code id="call" data-ref="call">fetch()</code>.</p>
<script src="kit:steps.js"></script><script src="kit:link.js"></script>
<script>
const state = () => ["m1", "m2"].map((ref) => document.querySelector('svg [data-ref="' + ref + '"]').getAttribute("data-state")).concat(document.getElementById("call").getAttribute("data-state")).join();
const opacity = (ref) => getComputedStyle(document.querySelector('svg [data-ref="' + ref + '"]')).opacity;
const next = () => document.querySelector('#seq [data-go="1"]').click();
${checks}</script></body></html>`;

test("a stepper's captions name the refs each step shows and lights, a sequence diagram's messages and parts outside it", async () => {
	// kit:link.js writes the states a step declares as the DOM change reaches its observer, so each check waits a frame.
	const checks = `${SETTLED}
var contract = settled.then(async () => {
	const failures = [];
	const expect = (ok, name) => { if (!ok) failures.push(name + ": " + state()); };
	const step = () => (next(), new Promise(requestAnimationFrame));
	expect(state() === "now,not-yet,now" && opacity("m2") === "0.15" && opacity("m1") === "1", "on the opening step the refs it names are now and a later one not-yet, ghosted");
	await step();
	expect(state() === ",now,", "the next step lights its message, and the refs reached before lose their state");
	await step();
	expect(state() === ",,now", "a ref named again later is lit again");
	return failures;
});`;
	expect(await packAndRun(dir, "sequence", SEQUENCE(checks))).toEqual([]);
	// The file shows the stepper whole: only the running script gives its refs a state.
	expect(readFileSync(dir.path("sequence.out.html"), "utf8")).not.toMatch(/<[^>]*\sdata-state=/);
}, 30_000);

test("print shows every part a stepper's refs ghost", async () => {
	const checks = pageContract({
		"a not-yet message prints at full opacity": `state() === "now,not-yet,now" && opacity("m2") === "1"`,
	});
	expect(await packAndRun(dir, "sequence-print", SEQUENCE(checks), { media: "print" })).toEqual([]);
}, 30_000);

test("a ref a stepper names that no element has fails the pack, naming the step", async () => {
	const input = dir.write(
		"missing-ref.html",
		SEQUENCE("").replace('data-refs="m2"', 'data-refs="m2 m9"'),
	);

	const packed = await packHtml(input, dir.path("missing-ref.out.html"));

	expect(packed.error).toContain(
		'the Stepper under "Sequence" names "m9" at step 2, but no element has data-ref="m9": give the part that ref, or correct the name',
	);
});

test("a part two steppers name is lit while one of them is on its step, though the other has not reached it", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Two</h1>
<figure class="fig" data-stepper data-start="1"><p>One</p><ol data-captions><li data-refs="call">Calls.</li><li>Done.</li></ol></figure>
<figure class="fig" data-stepper data-start="1"><p>Two</p><ol data-captions><li data-refs="other">First.</li><li data-refs="call">Calls.</li></ol></figure>
<p><code id="call" data-ref="call">fetch()</code> <b data-ref="other">other</b></p>
<script src="kit:steps.js"></script><script src="kit:link.js"></script>
<script>${pageContract({
		"now wins over not-yet, so the part a current caption explains is shown": `document.getElementById("call").getAttribute("data-state") === "now" && getComputedStyle(document.getElementById("call")).opacity === "1"`,
	})}</script></body></html>`;
	expect(await packAndRun(dir, "two-steppers", page)).toEqual([]);
}, 30_000);

test("a page's own data-state of now or not-yet, on no control's part, keeps the kit's stepper styles off", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Own</h1>
<p id="later" data-state="not-yet">Coming later.</p><p id="current" data-ref="current" data-state="now">Current.</p>
<script>${pageContract({
		"the page's not-yet is not faded": `getComputedStyle(document.getElementById("later")).opacity === "1"`,
		"the page's now is not lit": `getComputedStyle(document.getElementById("current")).backgroundColor === "rgba(0, 0, 0, 0)"`,
	})}</script></body></html>`;
	expect(await packAndRun(dir, "own-states", page)).toEqual([]);
}, 30_000);

/** A filled View whose records draw a Stepper over refs the record names; `refs` gives each record's steps. */
const RECORDS_PAGE = (refs: string[][]) => `---
title: Records
---
import { Stepper, View } from "kit";
import { Item } from "./item.tsx";

# Records

<p data-ref="intro">The intro.</p>

## Steps

<Stepper captions={["First", "Second"]} refs={["detail", "intro"]}><p>The steps.</p></Stepper>

<View name="item" records={${JSON.stringify(refs.map((steps, i) => ({ id: `r${i}`, steps })))}} render={Item} back="Records" />
`;

const ITEM_TSX = `"use client";
import { Stepper } from "kit";

export function Item({ record }: { record: { id: string; steps: string[] } }) {
	return (<>
		<h1>{record.id}</h1>
		<Stepper captions={["One", "Two"]} refs={record.steps}><p data-ref="detail">The detail.</p></Stepper>
	</>);
}
`;

test("refs count anywhere on the page, filled records included: a record's stepper is checked against the page and its record", async () => {
	const files = { "item.tsx": ITEM_TSX };

	const missing = await packMdx(
		dir,
		"record-refs",
		RECORDS_PAGE([
			["intro", "detail"],
			["m9", ""],
		]),
		files,
	);
	const fine = await packMdx(
		dir,
		"record-refs-fine",
		RECORDS_PAGE([
			["intro", "detail"],
			["detail", ""],
		]),
		files,
	);

	expect(missing.result.stderr).toContain(
		'in #item/r1 names "m9" at step 1, but no element has data-ref="m9"',
	);
	expect(missing.result.stderr).not.toContain('"detail"');
	expect(missing.result.stderr).not.toContain('"intro"');
	expect(fine.result).toMatchObject({ code: 0, stderr: "" });
}, 60_000);
