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

test("a wire that touches a part's lead joins its pin, so two nets meeting on a lead are reported", () => {
	// R2's pin m lands on the lead of C1's pin n, with no wire between them to show it.
	expect(
		problemsOf("C1 n nc @0,0", "R2 m nc v @1,0", "P1 port n @-4,0", "P2 port m @1,-4"),
	).toEqual([
		expect.stringMatching(/^lines 1, 2, 3, 4: nets (n and m|m and n) touch \(.*C1\.a.*R2\.a/),
	]);
});

test("an nc pin that touches anything is reported, whatever it touches", () => {
	const meets = [
		// An open pin on a live pin, with the junction dot the three meeting would draw.
		["R1 nc n @0,0", "R2 nc nc v a@R1.b", "R3 n nc @10,0"],
		// Two open pins meeting: nothing says they are one net, and nothing says they are not.
		["R1 nc nc @0,0", "R2 nc nc a@R1.b"],
		// An open pin on the lead of a live one.
		["C1 n 0 @0,0", "R2 nc 0 v @1,0", "P1 port n @-4,0"],
	];
	for (const lines of meets) {
		expect(problemsOf(...lines)).toEqual([
			expect.stringMatching(/^lines [\d, ]+: pins .* meet, and .*R[12]\.[ab] (is|are) nc \(open\)/),
		]);
	}
});

test("an IC that names a pin twice is rejected, also when the names differ only in their marks", () => {
	expect(problemsOf("U1 ic Test @0,0 left IN=0 right IN=nc")).toEqual([
		expect.stringMatching(/^line 1: U1: pin IN is listed twice/),
	]);
	expect(problemsOf('U1 ic Test @0,0 left V_{CC}=a right "VCC"=b')).toEqual([
		expect.stringMatching(/^line 1: U1: pin VCC is listed twice, as V_\{CC\}/),
	]);
});

/** The wires of a drawing as [x0, y0, x1, y1] runs. */
const wireRuns = (svg: string) =>
	[...svg.matchAll(/class="wire" d="([^"]*)"/g)].flatMap((m) => {
		const points = [...(m[1] ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => [
			Number(p[1]),
			Number(p[2]),
		]);
		return points.slice(1).map((p, i) => [...(points[i] ?? []), ...p] as number[]);
	});

test("no wire runs across the polarity marks of an electrolytic capacitor or a battery", () => {
	// Each mark lies above its part's lead, outside the body, which the wires of P1 and P2 used to run straight over.
	for (const [kind, mark] of [
		["electrolytic", { x0: 7, x1: 12, y0: -10.5, y1: -5.5 }],
		["battery", { x0: 3.5, x1: 8.5, y0: -10.5, y1: -5.5 }],
	] as const) {
		const drawn = renderSchematic(`C1 ${kind} nc nc @0,0\nP1 port n @-4,-1\nP2 port n @8,-1`);
		expect(drawn.problems).toEqual([]);
		const through = wireRuns(drawn.svg).filter(([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => {
			const [xa, xb, ya, yb] = [
				Math.min(x0, x1),
				Math.max(x0, x1),
				Math.min(y0, y1),
				Math.max(y0, y1),
			];
			return xa < mark.x1 && xb > mark.x0 && ya < mark.y1 && yb > mark.y0;
		});
		expect(through).toEqual([]);
	}
});

test("a drawing's smallest text, subscripts and IC pin names included, still reads at 10 px where it is narrowest", () => {
	const { svg } = renderSchematic(
		"U1 ic Chip @0,0 top V_{CC}=nc V_{DD}=nc left IN_{1}=nc right OUT_{2}=nc",
	);
	const sizes = [...svg.matchAll(/<(?:text|tspan)[^>]* font-size="([\d.]+)"/g)].map((m) =>
		Number(m[1]),
	);
	const [width = 0] = (/viewBox="\S+ \S+ (\S+)/.exec(svg) ?? []).slice(1).map(Number);
	const least = Number(/--schematic-min: (\d+)px/.exec(svg)?.[1]);
	expect(Math.min(...sizes)).toBeLessThan(10);
	expect((Math.min(...sizes) * least) / width).toBeGreaterThanOrEqual(9.99);
});

test("a routed wire blocks the straight runs of its path too, not only its corners", () => {
	// Found by fuzzing: the later wires ran along or ended on the straight part of an earlier one, which joined two nets.
	expect(problemsOf("R1 c 0 @6,0 v", "R2 b b @18,15 r270", "R3 c b @2,10 r270")).toEqual([]);
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
		"no text is under 10 px": `[...document.querySelectorAll(".schematic svg text, .schematic svg tspan[font-size]")].every((t) => parseFloat(getComputedStyle(t).fontSize) * (t.ownerSVGElement.getBoundingClientRect().width / t.ownerSVGElement.viewBox.baseVal.width) >= 9.99)`,
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
