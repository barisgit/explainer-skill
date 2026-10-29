import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSchematic } from "../skills/explainer/src/schematic/index.ts";
import { rivalOf } from "../skills/explainer/src/schematic/labels.ts";
import { parseNetlist } from "../skills/explainer/src/schematic/netlist.ts";
import { placeParts } from "../skills/explainer/src/schematic/place.ts";
import type { Part } from "../skills/explainer/src/schematic/scene.ts";
import { packAndRun, packMdx, pageContract, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The page with the three acceptance circuits: a µA723 regulator, a common-emitter amplifier and a two-stage amplifier of 18 parts. */
const CIRCUITS = join(import.meta.dir, "fixtures", "schematics", "page.mdx");
const blocksOf = (file: string) =>
	[...readFileSync(file, "utf8").matchAll(/```schematic\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? "");

const [regulator = "", commonEmitter = "", twoStage = ""] = blocksOf(CIRCUITS);

/** What `renderSchematic` reports for `lines`, as one string per problem. */
const problemsOf = (...lines: string[]) => renderSchematic(lines.join("\n")).problems;

test("the three acceptance circuits draw with no problems, and the regulator reads cleanly", () => {
	for (const source of [regulator, commonEmitter, twoStage]) {
		expect(renderSchematic(source).problems).toEqual([]);
	}
	// The measures the router is held to: the regulator once needed 10 bends and 2 crossings in the same 11 lines.
	const { stats } = renderSchematic(regulator);
	expect(stats.bends).toBeLessThanOrEqual(9);
	expect(stats.crossings).toBe(0);
	expect(renderSchematic(twoStage).stats.crossings).toBe(0);
});

test("a part is placed by an offset from a pin of another, whichever line comes first", () => {
	const draw = (...lines: string[]) => renderSchematic(lines.join("\n")).svg;
	const placed = (svg: string, id: string) =>
		new RegExp(`data-ref="${id}"[^>]*>.*?translate\\((-?[\\d.]+) (-?[\\d.]+)\\)`)
			.exec(svg)
			?.slice(1);
	const forward = draw("R1 a b 1k @0,0", "R2 b 0 2k a@R1.b 4,0", "R3 a 0 3k b@R2.b 0,0");
	const backward = draw("R3 a 0 3k b@R2.b 0,0", "R2 b 0 2k a@R1.b 4,0", "R1 a b 1k @0,0");
	// R1's pins are 40 apart, so R2's pin a lands at x = 40 + 4 units of 10.
	expect(placed(forward, "R2")).toEqual(["80", "0"]);
	expect(placed(backward, "R2")).toEqual(placed(forward, "R2"));
});

test("a netlist that does not say where a part goes, or by what, is rejected with the line", () => {
	expect(problemsOf("R1 a b 1k @0,0", "R2 b 0 2k")).toEqual([
		expect.stringMatching(/^line 2 \(R2\): say where it goes/),
	]);
	expect(problemsOf("R1 a b 1k @0,0", "R2 b 0 2k a@R9.a 0,2")).toEqual([
		"line 2 (R2): no part named R9 to place it by",
	]);
	expect(problemsOf("R1 a b 1k @0,0", "R2 b 0 2k a@R1.z 0,2")).toEqual([
		"line 2 (R2): R1 has no pin z (a, b)",
	]);
	expect(problemsOf("R1 a b 1k @0,0", "R1 b 0 2k @0,6")).toEqual([
		expect.stringMatching(/^line 2: R1 is already a part \(line 1\)/),
	]);
	expect(problemsOf("Z1 a b @0,0")).toEqual([expect.stringMatching(/^line 1: Z1: name a part by/)]);
});

test("pins on one point join without a wire, and a net that touches only one pin is an error unless it is nc", () => {
	const chain = renderSchematic("R1 0 b 1k @0,0\nR2 b c 2k a@R1.b\nR3 c 0 3k a@R2.b");
	expect(chain.problems).toEqual([]);
	// Only the ground stubs are wires: b and c are joined where the parts meet.
	expect(chain.svg).not.toMatch(/data-ref="(?!gnd)[^"]*" class="wire"/);
	expect(problemsOf("R1 a b 1k @0,0", "R2 b 0 2k a@R1.b 4,0")).toEqual([
		expect.stringMatching(/^line 1 \(R1\): net a joins only R1\.a; .*write nc/),
	]);
	expect(problemsOf("R1 nc b 1k @0,0", "R2 b 0 2k a@R1.b 4,0")).toEqual([]);
});

test("parts on top of each other are reported before any routing failure", () => {
	expect(problemsOf("R1 a b 1k @0,0", "R2 b a 2k @1,0")).toEqual([
		expect.stringMatching(/^line 2 \(R2\): overlaps R1 \(line 1\); place R2 further/),
	]);
});

test("every ground hangs down, and a ground pin that faces up is an error that says to turn the part", () => {
	const grounds = (svg: string) => [
		...svg.matchAll(/<g data-ref="gnd" data-kind="ground">.*?<g transform="([^"]*)"/g),
	];
	for (const source of [regulator, commonEmitter, twoStage]) {
		const found = grounds(renderSchematic(source).svg);
		expect(found.length).toBeGreaterThan(0);
		expect(found.every((m) => !(m[1] ?? "").includes("rotate"))).toBe(true);
	}
	// A vertical resistor's pin a is on top; the sideways one reaches its ground by a stub and the ground still hangs down.
	expect(problemsOf("R1 0 a 1k @0,0 v", "R2 a 0 1k a@R1.b v")).toEqual([
		expect.stringMatching(/^line 1 \(R1\): pin a is on ground but faces up.*turn R1/),
	]);
	const sideways = renderSchematic("R1 a 0 1k @0,0\nR2 a 0 1k a@R1.a 0,4");
	expect(sideways.problems).toEqual([]);
	expect(grounds(sideways.svg).every((m) => !(m[1] ?? "").includes("rotate"))).toBe(true);
});

test("a label belongs to its part only when it is strictly nearer that part than any other", () => {
	const { parts } = parseNetlist("R1 a b 1k @0,0 v\nR2 b 0 220 @4,0 v");
	placeParts(parts);
	const [r1, r2] = parts;
	const scene = { parts, wires: [] };
	const at = (x: number) => ({ x0: x, y0: 10, x1: x + 12, y1: 24 });
	// R1's body is at x = 0, R2's at x = 40: a box at 20..32 is nearer R2, one at 8..20 nearer R1, one midway ties.
	expect(rivalOf(at(20), r1 as Part, scene)?.id).toBe("R2");
	expect(rivalOf(at(8), r1 as Part, scene)).toBeUndefined();
	expect(rivalOf(at(14), r1 as Part, scene)?.id).toBe("R2");
	expect(rivalOf(at(8), r2 as Part, scene)?.id).toBe("R1");
});

test("labels with no clear owner are never drawn: crowded parts are reported, not given ambiguous labels", () => {
	const crowded = problemsOf(
		"R1 a b 1k @0,0 v",
		"R2 b 0 220 a@R1.a 3,0 v",
		"R3 a 0 4.7k a@R1.a 6,0 v",
	);
	expect(crowded).toEqual([
		expect.stringMatching(/^line 2 \(R2\): its label sits \d+ units from it/),
	]);
	expect(
		problemsOf("R1 a b 1k @0,0 v", "R2 b 0 220 a@R1.b 0,0 v", "R3 a 0 4.7k a@R1.a 12,0 v"),
	).toEqual([]);
});

test("pack fails a block with its number and the problem's line, and names what to write", async () => {
	const { result } = await packMdx(
		dir,
		"bad",
		"# T\n\n```schematic\nR1 a b 1k @0,0\nR2 b 0 2k a@R1.q 0,2\n```\n",
	);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("schematic block 1: line 2 (R2): R1 has no pin q (a, b)");
	expect(result.stderr).not.toContain("Fix: save remote files");
});

/** A page with the theme, link.js, two prose terms and the common-emitter circuit; its pageContract runs `checks`. */
const circuitPage = (checks: Record<string, string>) =>
	`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<p>The <span id="part" data-ref="R_C">collector resistor</span> and the <span id="net" data-ref="vcc">supply</span>.</p>
<pre class="schematic">${commonEmitter}</pre></main><script src="kit:link.js"></script><script>${pageContract(checks)}</script></body></html>`;

test("a part's name and a net's name in the prose light the part and the wires touching it, and dim the rest", async () => {
	const page = circuitPage({
		"hovering the part lights its group and the wires that end in it": `(() => {
			document.querySelector("#part").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
			const lit = [...document.querySelectorAll("svg .is-lit")];
			return lit.some((el) => el.matches("g[data-ref=R_C]"))
				&& lit.some((el) => el.matches("path.wire"))
				&& document.querySelector("svg").classList.contains("has-lit")
				&& getComputedStyle(document.querySelector("svg g[data-ref=Q1]")).opacity === "0.3";
		})()`,
		"hovering the net lights every wire and dot on it, not the other nets": `(() => {
			document.querySelector("#net").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
			const lit = [...document.querySelectorAll("svg .is-lit")];
			return lit.length > 2
				&& lit.every((el) => el.getAttribute("data-ref").split(" ").includes("vcc"))
				&& !document.querySelector("svg path[data-ref^='b ']").classList.contains("is-lit");
		})()`,
	});
	expect(await packAndRun(dir, "linked", page)).toEqual([]);
}, 30_000);

test("on a wide screen the drawing fills the column up to part names at body size, and no text is larger", async () => {
	const page = circuitPage({
		"names read at 16 px, the largest text anywhere, in a drawing narrower than the column": `(() => {
			const svg = document.querySelector(".schematic svg");
			const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
			const sizes = [...svg.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale);
			const narrow = svg.getBoundingClientRect().width < document.querySelector(".schematic").clientWidth;
			return Math.max(...sizes) <= 16.01 && (innerWidth < 640 || (narrow && Math.max(...sizes) >= 15.9));
		})()`,
	});
	expect(await packAndRun(dir, "wide", page)).toEqual([]);
}, 30_000);

test("on a phone the drawing keeps 10 px text and scrolls sideways; on paper it fits the column", async () => {
	const page = circuitPage({
		"no text is under 10 px": `[...document.querySelectorAll(".schematic svg text")].every((t) => parseFloat(getComputedStyle(t).fontSize) * (t.ownerSVGElement.getBoundingClientRect().width / t.ownerSVGElement.viewBox.baseVal.width) >= 9.99)`,
		"the block scrolls instead of shrinking": `(() => {
			const block = document.querySelector(".schematic");
			const svg = block.querySelector("svg");
			return svg.getBoundingClientRect().width >= parseFloat(getComputedStyle(svg).minWidth) - 1
				&& (innerWidth > 640 || block.scrollWidth > block.clientWidth);
		})()`,
	});
	expect(await packAndRun(dir, "phone", page)).toEqual([]);
	expect(
		await packAndRun(
			dir,
			"paper",
			circuitPage({
				"the drawing fits the column": `(() => {
					const block = document.querySelector(".schematic");
					return getComputedStyle(block.querySelector("svg")).minWidth === "0px" && block.scrollWidth <= block.clientWidth;
				})()`,
			}),
			{ media: "print" },
		),
	).toEqual([]);
}, 60_000);
