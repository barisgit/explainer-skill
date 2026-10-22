import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, SKILL_DIR, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const page = (markup: string) =>
	`<!doctype html><html><head></head><body>${markup}<p>hi</p></body></html>`;

describe("pack inlines what is local", () => {
	test("a local stylesheet (with its url() asset), a local script and a kit: file", async () => {
		dir.write("local.css", ".marker-css { background: url(dot.gif); }");
		dir.write("dot.gif", "GIF89a");
		dir.write("local.js", "window.markerScript = 1;");
		const input = dir.write(
			"inline.html",
			page(
				'<link rel="stylesheet" href="local.css"><script src="local.js"></script><script src="kit:link.js"></script>',
			),
		);
		const output = dir.path("inline.out.html");

		const result = await runCli(["pack", input, "-o", output]);

		expect(result.code).toBe(0);
		const html = readFileSync(output, "utf8");
		expect(html).toContain(".marker-css");
		expect(html).toContain("data:image/gif;base64,");
		expect(html).toContain("window.markerScript = 1;");
		const kitSource = readFileSync(join(SKILL_DIR, "kit", "link.js"), "utf8");
		expect(html).toContain(kitSource.slice(0, 60));
		expect(html).not.toMatch(/(href|src)="(local\.(css|js)|kit:link\.js)"/);
	});
});

test("pack of a missing page is a usage error (exit 2), not a stack trace", async () => {
	const result = await runCli(["pack", dir.path("absent.html"), "-o", dir.path("out.html")]);

	expect(result.code).toBe(2);
	expect(result.stderr).toStartWith("error: pack needs an existing page");
});

test("pack inlines a local url() in a style attribute", async () => {
	dir.write("attr.gif", "GIF89a");
	const input = dir.write("attr.html", page('<div style="background:url(attr.gif)"></div>'));
	const output = dir.path("attr.out.html");

	const result = await runCli(["pack", input, "-o", output]);

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).toContain("data:image/gif;base64,");
	expect(html).not.toContain("attr.gif");
});

describe("pack rejects network dependencies", () => {
	const remote = {
		script: [
			'<script src="https://cdn.example.com/lib.js"></script>',
			"remote script: https://cdn.example.com/lib.js",
		],
		stylesheet: [
			'<link rel="stylesheet" href="https://cdn.example.com/site.css">',
			"remote stylesheet: https://cdn.example.com/site.css",
		],
		"url() in a style": [
			"<style>body { background: url(https://cdn.example.com/bg.png); }</style>",
			"remote url(https://cdn.example.com/bg.png)",
		],
		"url() in a style attribute": [
			'<div style="background:url(https://cdn.example.com/a.png)"></div>',
			"remote url(https://cdn.example.com/a.png) in a style attribute",
		],
		"srcset on an img": [
			'<img srcset="https://cdn.example.com/a.png 1x, b.png 2x">',
			'<img srcset> is not inlined: use src with one local image (srcset="https://cdn.example.com/a.png 1x, b.png 2x")',
		],
	} as const;

	for (const [kind, [head, message]] of Object.entries(remote)) {
		test(`a remote ${kind} fails with exit 1 and names it`, async () => {
			const input = dir.write(`remote-${kind.replace(/\W+/g, "-")}.html`, page(head));
			const output = dir.path("rejected.html");

			const result = await runCli(["pack", input, "-o", output]);

			expect(result.code).toBe(1);
			expect(result.stderr).toContain("pack failed");
			expect(result.stderr).toContain(message);
			expect(await Bun.file(output).exists()).toBe(false);
		});
	}
});
