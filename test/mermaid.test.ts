import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("a Mermaid block renders to light and dark SVGs whose parts carry data-ref ids", async () => {
	const input = dir.write(
		"diagram.html",
		`<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body>
<pre class="mermaid">flowchart TD
  api --> cache[(Cache)]</pre></body></html>`,
	);
	const output = dir.path("diagram.out.html");

	const result = await runCli(["pack", input, "-o", output]);

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).not.toContain('class="mermaid">flowchart');
	for (const scheme of ["light", "dark"]) {
		const svg = new RegExp(`<svg class="${scheme}"[\\s\\S]*?</svg>`).exec(html)?.[0] ?? "";
		expect(svg).toContain('data-ref="api"');
		expect(svg).toContain('data-ref="cache"');
	}
}, 30_000);
