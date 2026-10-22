import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const SVG = (body: string, attrs = "") =>
	`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" ${attrs}>${body}</svg>`;

/** Packs a page (scheme forced when `scheme` is given) and returns the packed HTML and the `check` output, where each of `checks` runs 300 ms after load. */
async function packAndCheck(
	name: string,
	files: Record<string, string>,
	body: string,
	scheme: string,
	checks: Record<string, string>,
) {
	for (const [file, content] of Object.entries(files)) {
		dir.write(file, content);
	}
	const script = Object.entries(checks)
		.map(([check, expression]) => pageAssertion("svg image", check, expression))
		.join("\n");
	const input = dir.write(
		`${name}.html`,
		`<!doctype html><html${scheme ? ` data-scheme="${scheme}"` : ""}><head><link rel="stylesheet" href="kit:theme.css"></head><body>${body}<script>${script}</script></body></html>`,
	);
	const output = dir.path(`${name}.out.html`);
	const packed = await runCli(["pack", input, "-o", output]);
	expect(packed.stderr).toBe("");
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);
	return { html: readFileSync(output, "utf8"), out: checked.stdout };
}

const OK = "Verdict: ok, 0 problems";

/** Page expressions: the pixel of the one visible image, and the colour the page itself gives a token. */
const PIXELS = `
const shown = [...document.images].filter((img) => getComputedStyle(img).display !== "none");
const pixel = (x) => {
	const canvas = Object.assign(document.createElement("canvas"), { width: 120, height: 40 });
	const context = canvas.getContext("2d");
	context.drawImage(shown[0], 0, 0);
	return [...context.getImageData(x, 10, 1, 1).data.slice(0, 3)];
};
const token = (name) => {
	const probe = document.body.appendChild(document.createElement("i"));
	probe.style.color = "var(--" + name + ")";
	return getComputedStyle(probe).color.match(/\\d+/g).map(Number);
};
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 3);
`;

for (const scheme of ["", "light", "dark"]) {
	test(`an svg file in currentColor and var(--token) follows the ${scheme || "system"} scheme`, async () => {
		const { out } = await packAndCheck(
			`theme-${scheme || "system"}`,
			{
				"fig.svg": SVG(
					`<rect width="20" height="20" fill="currentColor"/><rect x="100" width="20" height="20" fill="var(--accent)"/>`,
				),
			},
			'<img src="fig.svg" alt="a figure">',
			scheme,
			{
				"one image is shown": `(() => { ${PIXELS} return shown.length === 1; })()`,
				"currentColor is the page's ink": `(() => { ${PIXELS} return same(pixel(10), token("ink")); })()`,
				"var(--accent) is the page's accent": `(() => { ${PIXELS} return same(pixel(110), token("accent")); })()`,
			},
		);

		expect(out).toContain(OK);
	}, 30_000);
}

test("a colour the file sets on its root wins over the theme", async () => {
	const { out } = await packAndCheck(
		"own-color",
		{
			"own.svg": SVG(
				'<rect width="20" height="20" fill="currentColor"/>',
				'style="color: rgb(0, 0, 255)"',
			),
		},
		'<img src="own.svg" alt="">',
		"dark",
		{ "the file's blue stays": `(() => { ${PIXELS} return same(pixel(10), [0, 0, 255]); })()` },
	);

	expect(out).toContain(OK);
}, 30_000);

test("both variants carry the img's attributes and only the shown one is in the page flow", async () => {
	const { html, out } = await packAndCheck(
		"attributes",
		{ "a.svg": SVG("<rect/>") },
		'<img id="f" class="drawing" src="a.svg" alt="a figure" data-ref="x" width="60" style="display: block"><p data-ref="x">x</p>',
		"",
		{
			"two images, one shown": `document.images.length === 2 && [...document.images].filter((img) => getComputedStyle(img).display !== "none").length === 1`,
			"light and dark classes beside the author's": `[...document.images].map((img) => img.className).join() === "drawing light,drawing dark"`,
			"alt, data-ref and width on both": `[...document.images].every((img) => img.alt === "a figure" && img.dataset.ref === "x" && img.getAttribute("width") === "60")`,
			"the id stays unique": `document.querySelectorAll("#f").length === 1`,
		},
	);

	expect(out).toContain(OK);
	expect(html).not.toContain('src="a.svg"');
}, 30_000);

test("an svg file in a picture stays one data-URI image", async () => {
	const { html } = await packAndCheck(
		"picture",
		{ "p.svg": SVG("<rect/>") },
		'<picture><source media="(min-width: 1px)" type="image/svg+xml"><img src="p.svg" alt=""></picture>',
		"",
		{},
	);

	expect(html.match(/<img [^>]*src=/g)).toHaveLength(1);
	expect(html).toContain("data:image/svg+xml;base64,");
}, 30_000);

test("a Mermaid diagram still shows only the copy for the scheme", async () => {
	const { out } = await packAndCheck(
		"diagram",
		{},
		'<pre class="mermaid">flowchart LR\n a --> b</pre>',
		"dark",
		{
			"the dark copy is the one shown": `[...document.querySelectorAll(".mermaid > svg")].filter((svg) => getComputedStyle(svg).display !== "none").map((svg) => svg.getAttribute("class")).join() === "dark"`,
		},
	);

	expect(out).toContain(OK);
}, 30_000);
