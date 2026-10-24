import { afterAll, expect, test } from "bun:test";
import { ENGLISH, labelsScript, SLOVENIAN } from "./labels-contract.ts";
import { packAndRun, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/**
 * A page with a stepper, nested views (rail and trail, no .back link, so the overview's name is the label), two folds, a reply
 * question and three note parts: in a headed section, in a named figure, and outside any section. Its script, after the kit
 * scripts, sets `labels` as kitLabels when given. After load it works each component, and its `contract` resolves with the name of
 * every text that is not `expected`'s (see packAndRun).
 */
const PAGE = (
	lang: string,
	expected: typeof ENGLISH,
	labels?: typeof ENGLISH,
) => `<!doctype html><html lang="${lang}"><head>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="kit:theme.css"></head><body>
<main class="page"><div data-overview><h1>Labels</h1>
<p>A <span data-ref="loose">loose</span> part.</p>
<section><h2>People</h2><p><a href="#p/a">A</a> <a href="#p/b">B</a></p>
<details><summary>One</summary><p>1</p></details><details><summary>Two</summary><p>2</p></details></section>
<section><h2>Items</h2><p><a href="#i/1">One</a>, and the <span data-ref="cache">cache</span>.</p>
<figure aria-label="Scheme"><p>The <span data-ref="db">db</span>.</p></figure>
<fieldset data-reply><legend>Pick</legend><label><input type="radio" name="p" value="a" id="pa"> A</label> <label><input type="radio" name="p" value="b" id="pb"> B</label></fieldset>
<figure class="fig" id="s" data-stepper><svg viewBox="0 0 50 20" width="150"><rect data-step="1" width="20" height="20"/><rect data-step="2" x="30" width="20" height="20"/></svg>
<ol data-captions><li>one</li><li>two</li></ol></figure></section></div>
<section class="view" data-view="p"><h1>Person</h1></section>
<section class="view" data-view="i"><h1>Item</h1></section></main>
<script src="kit:steps.js"></script><script src="kit:views.js"></script><script src="kit:reply.js"></script>
<script>
${labels ? `var kitLabels = ${JSON.stringify(labels)};` : ""}
${labelsScript(expected)}</script></body></html>`;

// The run is slowed four times, so the kit's own timers and the page's work interleave as on a slow machine.
test("kitLabels set after the kit scripts reach every text they add: stepper, views navigation, folds, reply and notes", async () => {
	expect(await packAndRun(dir, "sl", PAGE("sl", SLOVENIAN, SLOVENIAN), { slowdown: 4 })).toEqual(
		[],
	);
}, 60_000);

test("without kitLabels the kit's texts are English", async () => {
	expect(await packAndRun(dir, "en", PAGE("en", ENGLISH), { slowdown: 4 })).toEqual([]);
}, 60_000);
