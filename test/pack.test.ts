import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
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
		const kitSource = readFileSync(join(SKILL_DIR, "kit", "link.ts"), "utf8");
		expect(html).toContain(kitSource.slice(0, 60));
		expect(html).not.toMatch(/(href|src)="(local\.(css|js)|kit:link\.js)"/);
	});

	test("a page's own .ts script is inlined as written, not transpiled like the kit", async () => {
		const source = '"use strict";\nwindow.markerTs = (x: number) => x;';
		dir.write("own.ts", source);
		const input = dir.write("own-ts.html", page('<script src="own.ts"></script>'));
		const output = dir.path("own-ts.out.html");

		const result = await runCli(["pack", input, "-o", output]);

		expect(result.code).toBe(0);
		expect(readFileSync(output, "utf8")).toContain(source);
	});
});

test("a kit script ships as a classic script with its documentation comment", async () => {
	const names = ["charts", "link", "plot", "reply", "steps", "views"];
	const input = dir.write(
		"kit-scripts.html",
		page(names.map((n) => `<script src="kit:${n}.js"></script>`).join("")),
	);
	const output = dir.path("kit-scripts.out.html");

	const result = await runCli(["pack", input, "-o", output]);

	expect(result.code).toBe(0);
	const scripts = [...readFileSync(output, "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)];
	expect(scripts).toHaveLength(names.length);
	for (const [, body = ""] of scripts) {
		expect(body.trimStart()).toStartWith("/* ");
		// Parsing as a function body rejects import/export, which a module-shaped output would contain.
		expect(() => new Function(body)).not.toThrow();
	}
});

test("kit:theme.css ships whole: its parts in name order, then theme.css, with the fonts inlined", async () => {
	const partsDir = join(SKILL_DIR, "kit", "parts", "theme");
	const sources = [
		...readdirSync(partsDir)
			.sort()
			.map((part) => join(partsDir, part)),
		join(SKILL_DIR, "kit", "theme.css"),
	];
	const input = dir.write("theme.html", page('<link rel="stylesheet" href="kit:theme.css">'));
	const output = dir.path("theme.out.html");

	const result = await runCli(["pack", input, "-o", output]);

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	// Each source opens with its own comment line, which marks where it starts in the packed stylesheet.
	const starts = sources.map((file) =>
		html.indexOf(readFileSync(file, "utf8").split("\n")[0] ?? ""),
	);
	expect(starts).not.toContain(-1);
	expect(starts).toEqual(starts.toSorted((a, b) => a - b));
	// The parts' font urls resolve against kit/, where theme.css lies.
	expect(html).toContain("data:font/woff2;base64,");
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

test.each([
	{
		name: "a local url() written with CSS escapes",
		markup: '<div style="background:\\75 rl(local.png)"></div>',
		message:
			"url(local.png) in a style attribute is not inlined: write url() without CSS escapes so pack can inline it",
	},
	{
		name: "an HTML entity pack does not decode in an SVG paint",
		markup: '<svg><rect fill="url&lpar;#p&rpar;"/></svg>',
		message:
			"<rect fill> uses the HTML entity &lpar;, which pack does not read: write the character itself",
	},
	{
		name: "a stylesheet the CSS parser cannot read",
		markup: "<style>}}} b { color: red; }</style>",
		message: "pack cannot read the CSS in <style>",
	},
])("$name fails the pack, since it may load something", async ({ markup, message }) => {
	const input = dir.write("hidden-load.html", page(markup));

	const result = await runCli(["pack", input, "-o", dir.path("hidden-load.out.html")]);

	expect(result.code).toBe(1);
	expect(result.stderr).toContain(message);
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
		"url() written with CSS escapes in a style": [
			"<style>body { background: \\75\frl(https://cdn.example.com/e.png); }</style>",
			"remote url(https://cdn.example.com/e.png) in <style>",
		],
		"url() written with CSS escapes in a style attribute": [
			'<div style="background:\\75 rl(https://cdn.example.com/f.png)"></div>',
			"remote url(https://cdn.example.com/f.png) in a style attribute",
		],
		"image-set() string in a style": [
			'<style>b { background: image-set("https://cdn.example.com/h.png" 1x); }</style>',
			"remote url(https://cdn.example.com/h.png) in <style>",
		],
		"@import written with CSS escapes": [
			'<style>@\\69mport "https://cdn.example.com/x.css";</style>',
			"@import in <style>: put the CSS in a <link> or <style> instead",
		],
		"paint attribute of an inline SVG, written with an HTML entity": [
			'<svg><rect fill="u&#x72;l(https://cdn.example.com/g.svg#p)"/></svg>',
			"remote url(https://cdn.example.com/g.svg#p) in <rect fill>",
		],
		"href of an inline SVG <use>": [
			'<svg><use href="https://cdn.example.com/s.svg#i"/></svg>',
			"remote <use href>: https://cdn.example.com/s.svg#i",
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
