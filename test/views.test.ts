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
