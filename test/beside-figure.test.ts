import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inPage, runCli, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const fixture = join(import.meta.dir, "fixtures/beside-figure/page.mdx");
const widths = [
	{ width: 3840, height: 2160, mobile: false },
	{ width: 1920, height: 1080, mobile: false },
	...WIDTHS,
];

test("captioned drawings fit beside a full-width list, with the image inside its pinned panel (#319)", async () => {
	const output = dir.path("trial.html");
	const pack = await runCli(["pack", fixture, "-o", output]);
	expect(pack.stderr).toBe("");
	expect(pack.code).toBe(0);
	for (const viewport of widths) {
		const seen = await inPage(
			output,
			(cdp) =>
				cdp.evaluate(`(() => {
			const box = (el) => el.getBoundingClientRect();
			return [...document.querySelectorAll('.beside')].map((layout) => {
				const [list, figure] = layout.children;
				const drawing = [...figure.querySelectorAll('img, .schematic svg, .mermaid svg')].find((el) => box(el).height > 0);
				const l = box(list), f = box(figure), d = box(drawing);
				const img = drawing.matches('img');
				const text = document.createRange();
				const lastInk = Math.max(...[...list.children].map((item) => {
					text.selectNodeContents(item);
					return text.getBoundingClientRect().right;
				}));
				text.selectNodeContents(list.firstElementChild);
				const headingStart = box(layout.previousElementSibling).left;
				return {
					id: layout.id,
					pageFits: document.documentElement.scrollWidth <= innerWidth,
					listAligned: l.left === headingStart &&
						(innerWidth < 896 || text.getBoundingClientRect().left === headingStart),
					drawn: d.width > 0 && (!img || drawing.naturalWidth > 0),
					layoutFits: innerWidth < 896 ? f.top >= l.bottom :
						f.left > l.right && d.left - l.right <= 64 && l.width <= 48 * 16 + 1 &&
						f.width - d.width <= 2 &&
						(img || drawing.parentElement.scrollWidth <= drawing.parentElement.clientWidth + 1) &&
						(innerWidth < 3840 || d.left - lastInk <= 64),
					pinnedHeight: !img || innerWidth < 896 ||
						(f.height <= innerHeight - 48 && d.bottom <= f.bottom &&
							d.height > (innerHeight - 48) * 0.85 && box(figure.lastElementChild).bottom <= f.bottom + 1),
				};
			});
		})()`),
			viewport,
		);
		expect(seen, `${viewport.width}×${viewport.height}`).toEqual(
			["circuit", "flow", "image"].map((id) => ({
				id,
				pageFits: true,
				listAligned: true,
				drawn: true,
				layoutFits: true,
				pinnedHeight: true,
			})),
		);
	}

	const scrollsToCaption = await inPage(
		output,
		(cdp) =>
			cdp.evaluate(`(() => {
				const figure = document.querySelector("#image figure");
				const image = [...figure.querySelectorAll("img")].find((img) => img.offsetHeight);
				const caption = figure.querySelector("figcaption");
				caption.textContent = "A longer caption can wrap under a tall image. ".repeat(9);
				const bottom = figure.getBoundingClientRect().bottom;
				const imageFits = image.offsetHeight > 0 && image.getBoundingClientRect().bottom < bottom;
				figure.scrollTop = figure.scrollHeight;
				return imageFits && figure.scrollTop > 0 && caption.getBoundingClientRect().bottom <= bottom + 1;
			})()`),
		{ width: 1920, height: 600, mobile: false },
	);
	expect(scrollsToCaption).toBe(true);
}, 30_000);

test("check flags a captioned drawing stranded in an oversized pinned column at a custom viewport", async () => {
	const packed = dir.path("packed.html");
	const pack = await runCli(["pack", fixture, "-o", packed]);
	expect(pack.code).toBe(0);
	const file = dir.write(
		"oversized.html",
		readFileSync(packed, "utf8")
			.replace(
				"</head>",
				"<style>@media(min-width:3000px){#circuit{display:grid;grid-template-columns:2fr 3fr}}</style></head>",
			)
			.replace(
				"<figcaption>Calculate the current",
				"<p>Working current: 1 mA.</p><figcaption>Calculate the current",
			),
	);
	const result = await runCli([
		"check",
		file,
		"--quick",
		"--viewport",
		"3840x2160",
		"--out",
		dir.path("shots"),
	]);
	expect(result.code).toBe(0);
	expect(result.stdout).toMatch(
		/div#circuit\.beside: drawing uses only \d+px of its \d+px pinned column.*\n\s+at:.*3840x2160/,
	);
	expect(result.stdout).not.toContain("div#flow.beside: drawing uses only");
	expect(result.stdout).not.toContain("div#image.beside: drawing uses only");
}, 30_000);

test("check flags a pinned drawing laid out taller than wide once per panel, with a fix for its kind", async () => {
	const nodes = ["a", "b", "c", "d", "e", "f", "g", "h"];
	const fence = (lang: string, source: string) => `\`\`\`${lang}\n${source}\n\`\`\``;
	const map = (direction: string, count = nodes.length) =>
		fence(
			"mermaid",
			`flowchart ${direction}\n${nodes
				.slice(1, count)
				.map((n, i) => `\t${nodes[i]}["Part ${nodes[i]}"] -->|"sends"| ${n}["Part ${n}"]`)
				.join("\n")}`,
		);
	const circuit = fence(
		"schematic",
		[
			"VIN port in Input @-18,0",
			"R1 in n1 10k @0,0 v",
			...[2, 3, 4, 5, 6, 7].map((i) => `R${i} n${i - 1} n${i} 10k a@R${i - 1}.b 0,60 v`),
			"R8 n7 0 10k a@R7.b 0,60 v",
		].join("\n"),
	);
	const list = nodes.map((n) => `- <span data-ref="${n}">Part ${n}</span>`).join("\n");
	const section = (id: string, drawing: string) =>
		`## Map ${id}\n\n<div class="beside" data-width="full" id="${id}">\n\n${list}\n\n${drawing}\n\n</div>\n`;
	const framed = `<figure class="fig">\n<h3>Parts</h3>\n\n${map("TB")}\n\n<figcaption>The parts.</figcaption>\n</figure>`;
	const page = dir.write(
		"maps/page.mdx",
		`# Maps\n\n${[
			section("tall", map("TB")),
			section("wide", map("LR")),
			section("short", map("TB", 3)),
			section("framed", framed),
			section("circuit", circuit),
		].join("\n")}`,
	);
	const output = dir.path("maps.html");
	expect((await runCli(["pack", page, "-o", output])).code).toBe(0);
	const result = await runCli(["check", output, "--quick"]);
	expect(result.code).toBe(0);
	const warned = (id: string) =>
		result.stdout
			.split("\n")
			.filter((line) => line.includes(`div#${id}.beside: its pinned drawing is`));
	for (const id of ["tall", "framed"]) {
		expect(warned(id), id).toHaveLength(1);
		expect(warned(id)[0]).toMatch(
			/taller than wide .*: lay it out wider than tall \(direction LR, or parts grouped in subgraphs\), or split it/,
		);
	}
	expect(warned("circuit")).toHaveLength(1);
	expect(warned("circuit")[0]).toMatch(/: place its parts along a wider row, or split it/);
	expect(warned("wide")).toEqual([]);
	expect(warned("short")).toEqual([]);
}, 30_000);
