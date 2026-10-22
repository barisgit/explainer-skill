import { afterAll, expect, test } from "bun:test";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Views</h1>
<div data-overview>overview</div>
<section class="view" data-view="v"><h2>View</h2></section></main>
<script src="kit:views.js"></script>
<script>
let param;
Views.on("v", (_, p) => { param = p; });
document.addEventListener("DOMContentLoaded", () => { location.hash = "#v/100%"; });
${pageAssertion(
	"views contract",
	"a hash with a malformed escape still opens its view, with the param as written",
	'param === "100%" && document.documentElement.classList.contains("in-view")',
)}
</script></body></html>`;

test("a hash with a malformed percent escape does not break the router", async () => {
	const input = dir.write("views.html", PAGE);
	const output = dir.path("views.out.html");

	const packed = await runCli(["pack", input, "-o", output]);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);

	expect(packed.code).toBe(0);
	expect(checked.stdout).not.toContain("views contract");
	expect(checked.code).toBe(0);
}, 30_000);

const ANCHOR_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<div data-overview><h1>Views</h1><div style="block-size: 3000px"></div><section id="far"><h2>Far</h2></section><div style="block-size: 3000px"></div></div>
<section class="view" data-view="v"><h2>View</h2><a id="to-far" href="#far">Far section</a></section></main>
<script src="kit:views.js"></script>
<script>
// The overview is hidden when the hash changes, so the browser cannot scroll to #far then; Chrome keeps the fragment scroll pending
// until the section has a box. The router restores the overview's old position on the same change and must not undo that.
addEventListener("load", () => {
	location.hash = "#v/a";
	setTimeout(() => document.getElementById("to-far").click(), 50);
	setTimeout(() => {
		const far = document.getElementById("far").getBoundingClientRect().top;
		if (document.documentElement.classList.contains("in-view") || Math.abs(far) > 2) {
			throw new Error("views contract: a link from a view to a section's #id lands on that section (top " + far + ")");
		}
	}, 250);
});
</script></body></html>`;

test("a link from a view to an overview section's #id scrolls to that section", async () => {
	const input = dir.write("anchor.html", ANCHOR_PAGE);
	const output = dir.path("anchor.out.html");

	const packed = await runCli(["pack", input, "-o", output]);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("anchor"),
	]);

	expect(packed.code).toBe(0);
	expect(checked.stdout).not.toContain("views contract");
	expect(checked.code).toBe(0);
}, 30_000);
