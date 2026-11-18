import { afterAll, expect, test } from "bun:test";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { FRAMES, inPage, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Page statement: the reader acts on the page (a plot moves only after the reader has acted, never on arrival). */
const READER = `document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`;

/** Allows motion in the page, which inPage opens with reduced motion as check does. */
const motion = (cdp: Cdp, value = "no-preference") =>
	cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] });

const { between } = (
	runKitPart("plot/tween.ts", "PlotTween") as () => {
		between(
			from: object,
			to: object,
			k: number,
		): {
			series: { data: (number | number[])[] }[];
			marks?: { x?: number }[];
			y?: { max?: number };
		};
	}
)();

test("a tween step moves bars, points and axis bounds part of the way; a line of another length is read off the old one", () => {
	const half = between(
		{ categories: ["a", "b"], series: [{ type: "bar", data: [0, 10] }], y: { max: 10 } },
		{ categories: ["a", "b"], series: [{ type: "bar", data: [10, 20] }], y: { max: 30 } },
		0.5,
	);
	expect(half.series[0]?.data).toEqual([5, 15]);
	expect(half.y?.max).toBe(20);

	// An RC rise against a marker at 300 ns: the curve changes its points, the marker stays.
	const rc = (tau: number, n: number) =>
		Array.from({ length: n }, (_, i) => [
			(i * 600) / (n - 1),
			1 - Math.exp(-(i * 600) / (n - 1) / tau),
		]);
	const from = { series: [{ name: "v", data: rc(100, 7) }], marks: [{ x: 300, label: "300 ns" }] };
	const to = { series: [{ name: "v", data: rc(200, 13) }], marks: [{ x: 300, label: "300 ns" }] };
	const step = between(from, to, 0.5);
	expect(step.marks?.[0]?.x).toBe(300);
	const points = step.series[0]?.data as number[][];
	expect(points).toHaveLength(13);
	// At 300 ns the old curve is at 0.950, the new one at 0.777: halfway is 0.864.
	expect(points[6]?.[0]).toBe(300);
	expect(points[6]?.[1]).toBeCloseTo((0.9502 + 0.7769) / 2, 3);

	// A bar series of another length, or a series with no counterpart, is the new one at once.
	expect(
		between(
			{ series: [{ type: "bar", data: [1] }] },
			{
				series: [
					{ type: "bar", data: [3, 4] },
					{ type: "bar", data: [5, 6] },
				],
			},
			0.5,
		).series.map((s) => s.data),
	).toEqual([
		[3, 4],
		[5, 6],
	]);
});

/** A client component that switches an RC rise's time constant, against a marker at 300 ns, as an Explore frame would. */
const RC = `"use client";
import { Plot } from "kit";
import { useState } from "preact/hooks";

const rise = (tau: number) => Array.from({ length: 61 }, (_, i) => [i * 10, 1 - Math.exp(-(i * 10) / tau)]);
export function Rise() {
	const [tau, setTau] = useState(60);
	return (
		<div>
			<button type="button" id="slow" onClick={() => setTau(240)}>Slower</button>
			<Plot id="rc" label="RC rise" option={{
				x: { min: 0, max: 600, format: { unit: "ns" } }, y: { min: 0, max: 1 }, marks: [{ x: 300, label: "300 ns" }],
				series: [{ name: "capacitor", data: rise(tau) }, { name: "input", data: [[0, 1], [600, 1]] }],
			}} />
		</div>
	);
}
`;

/** Each named line's end text y, the marker's x and the capacitor line's last point y, in the drawn plot. */
const RC_STATE = `(() => {
	const svg = document.querySelector("#rc .plot-area > svg");
	const end = [...svg.querySelectorAll("text.end")].find((t) => t.textContent === "capacitor");
	const d = svg.querySelector("path.line").getAttribute("d");
	return { end: Number(end.getAttribute("y")), last: Number(d.split(",").at(-1)), mark: Number(svg.querySelector("line.mark").getAttribute("x1")) };
})()`;

test("a new option moves a drawn plot from where it was: a line morphs with its end name, a fixed marker stays (#190)", async () => {
	const output = await packedMdx(
		dir,
		"rc",
		`import { Rise } from "./rise.tsx";\n\n# Rise\n\n<Rise />\n`,
		{ "rise.tsx": RC },
	);
	await inPage(output, async (cdp) => {
		const before = await cdp.evaluate<{ end: number; last: number; mark: number }>(RC_STATE);
		// Reduced motion (as inPage runs): the plot is at the new option in the frame after the change.
		const still = await cdp.evaluate<{ end: number; last: number; mark: number }>(
			`${READER}, document.getElementById("slow").click(), new Promise(requestAnimationFrame).then(() => new Promise(requestAnimationFrame)).then(() => ${RC_STATE})`,
			true,
		);
		expect(still.last).toBeGreaterThan(before.last + 20);
		await cdp.load(`file://${output}`);
		await motion(cdp);
		// The first drawing never moves: the plot is drawn whole as it loads, with motion allowed.
		const first = await cdp.evaluate<{ end: number; last: number; mark: number }>(
			`document.fonts.ready.then(() => ${RC_STATE})`,
			true,
		);
		expect(first).toEqual(before);
		const steps = await cdp.evaluate<{ end: number; last: number; mark: number }[]>(
			`(async () => {
				${READER};
				document.getElementById("slow").click();
				const seen = [];
				const t0 = performance.now();
				while (performance.now() - t0 < 700) {
					await new Promise(requestAnimationFrame);
					seen.push(${RC_STATE});
				}
				return seen;
			})()`,
			true,
		);
		const mid = steps.filter((s) => s.last > before.last + 1 && s.last < still.last - 1);
		expect(mid.length).toBeGreaterThan(2);
		for (const s of [...mid, ...steps]) {
			expect(s.mark).toBe(before.mark);
		}
		// The end name follows the line's end, spread a line apart from the input's name only where they meet.
		for (const s of mid.filter((s) => Math.abs(s.last - first.last) > 20)) {
			expect(s.end).toBeCloseTo(s.last, 0);
		}
		expect(steps.at(-1)).toEqual(still);
	});
}, 30_000);

test("series are matched by name, unnamed ones by position: a line taken away or added leaves the others where they are", () => {
	const a = {
		name: "a",
		data: [
			[0, 0],
			[1, 1],
		],
	};
	const b = {
		name: "b",
		data: [
			[0, 5],
			[1, 5],
		],
	};
	const a2 = {
		name: "a",
		data: [
			[0, 2],
			[1, 3],
		],
	};
	expect(between({ series: [a, b] }, { series: [b] }, 0.5).series.map((s) => s.data)).toEqual([
		b.data,
	]);
	// A new series is drawn as it is at once; the one it was put in front of keeps its own way.
	expect(between({ series: [b] }, { series: [a, b] }, 0.5).series.map((s) => s.data)).toEqual([
		a.data,
		b.data,
	]);
	expect(between({ series: [b, a] }, { series: [a2, b] }, 0.5).series.map((s) => s.data)).toEqual([
		[
			[0, 1],
			[1, 2],
		],
		b.data,
	]);
	const bars = (data: number[]) => ({ type: "bar", data });
	expect(
		between(
			{ series: [bars([0]), bars([10])] },
			{ series: [bars([2]), bars([20])] },
			0.5,
		).series.map((s) => s.data),
	).toEqual([[1], [15]]);
});

/** The RC page's state after the reader asks for the slower rise, a frame into the move. */
const MID_MOVE = `${READER}, document.getElementById("slow").click(), new Promise(requestAnimationFrame).then(() => new Promise(requestAnimationFrame)).then(() => new Promise(requestAnimationFrame))`;

test("printing, or turning motion off, during a move draws where it goes at once", async () => {
	const output = await packedMdx(
		dir,
		"rc-print",
		`import { Rise } from "./rise.tsx";\n\n# Rise\n\n<Rise />\n`,
		{
			"rise.tsx": RC,
		},
	);
	await inPage(output, async (cdp) => {
		const still = await cdp.evaluate<object>(
			`document.getElementById("slow").click(), new Promise(requestAnimationFrame).then(() => new Promise(requestAnimationFrame)).then(() => ${RC_STATE})`,
			true,
		);
		await cdp.load();
		await motion(cdp);
		await cdp.evaluate(`document.fonts.ready`, true);
		await cdp.evaluate(MID_MOVE, true);
		expect(await cdp.evaluate(RC_STATE)).not.toEqual(still);
		expect(await cdp.evaluate(`dispatchEvent(new Event("beforeprint")), ${RC_STATE}`)).toEqual(
			still,
		);

		await cdp.load();
		await cdp.evaluate(`document.fonts.ready`, true);
		await cdp.evaluate(MID_MOVE, true);
		await motion(cdp, "reduce");
		const after = await cdp.evaluate(`${FRAMES}.then(() => ${RC_STATE})`, true);
		expect(after).toEqual(still);
	});
}, 30_000);

/** A client component with a picked bar plot, its values on the bars and in the key, and a button that triples them. */
const PICKED = `"use client";
import { Plot } from "kit";
import { useState } from "preact/hooks";

export function Picked() {
	const [k, setK] = useState(1);
	return (
		<div>
			<button type="button" id="grow" onClick={() => setK(3)}>Grow</button>
			<Plot id="p" label="Picked" pick={{ choose: () => {} }} option={{ categories: ["a", "b"], pick: 0, y: { min: 0, max: 100 }, series: [
				{ name: "one", type: "bar", data: [10 * k, 20 * k], label: true },
				{ name: "two", type: "bar", data: [5 * k, 7 * k] },
			] }} />
		</div>
	);
}
`;

test("while a plot moves its numbers are where it goes, and the key keeps its buttons and the reader's focus", async () => {
	const output = await packedMdx(
		dir,
		"picked",
		`import { Picked } from "./picked.tsx";\n\n# Picked\n\n<Picked />\n`,
		{
			"picked.tsx": PICKED,
		},
	);
	await inPage(output, async (cdp) => {
		await motion(cdp);
		const frames = await cdp.evaluate<
			{ focused: boolean; keys: string[]; labels: string[]; height: number }[]
		>(
			`(async () => {
				const button = document.querySelector('#p .plot-legend button[data-i="1"]');
				button.focus();
				${READER};
				document.getElementById("grow").click();
				const seen = [];
				const t0 = performance.now();
				while (performance.now() - t0 < 700) {
					await new Promise(requestAnimationFrame);
					seen.push({
						focused: document.activeElement === button && button.isConnected,
						keys: [...document.querySelectorAll("#p .plot-legend .v")].map((v) => v.textContent),
						labels: [...document.querySelectorAll("#p svg text.value")].map((t) => t.textContent),
						height: Number(document.querySelector("#p svg rect.bar").getAttribute("height")),
					});
				}
				return seen;
			})()`,
			true,
		);
		// The frames before the component re-renders show the old option; from then on every text is the new one's.
		const [first, end] = [frames[0]?.height ?? 0, frames.at(-1)?.height ?? 0];
		const moving = frames.filter((f) => f.height > first + 1 && f.height < end - 1);
		expect(moving.length).toBeGreaterThan(2);
		expect(frames.every((f) => f.focused)).toBe(true);
		for (const f of frames.filter((f) => f.height > first + 1)) {
			expect(f).toMatchObject({ keys: ["30", "15"], labels: ["30", "60"] });
		}
	});
}, 30_000);

/** A precomputed Explore whose choice switches a line, for a reload that restores the choice. */
const RESTORED = `import { Explore } from "kit";

# Restored

<Explore id="f" label="Lines" controls={[{ id: "n", label: "Terms", choice: ["3", "9"] }]} frame={(n) => ({ plot: { series: [{ data: Array.from({ length: 21 }, (_, i) => [i, i % Number(n)]) }] } })} />
`;

/** Capture what the live renderer draws, not pixel paths that also change as fonts and sizing settle. */
const WATCH_DRAWS = `
window.plotDraws = [];
let factory;
Object.defineProperty(window, "PlotDraw", {
	get: () => factory,
	set(value) {
		factory = (...args) => {
			const api = value(...args);
			return { ...api, render(option, ...rest) {
				window.plotDraws.push(JSON.stringify(option.series));
				return api.render(option, ...rest);
			} };
		};
	},
});
// Startup can redraw identical data at different sizes; that is not an animation of its option.
addEventListener("load", () => {
	setTimeout(() => document.querySelector("#f").style.width = "80%", 100);
	setTimeout(() => document.querySelector("#f").style.width = "", 300);
});
`;

/** Observe from before restoration through its first 700 ms, without settling away a possible arrival animation. */
const drawnOnArrival = (cdp: Cdp) =>
	cdp.evaluate<string[]>(
		`(async () => {
			const t0 = performance.now();
			while (performance.now() - t0 < 700) await new Promise(requestAnimationFrame);
			return window.plotDraws;
		})()`,
		true,
	);

const restoredSeries = (n: number) =>
	JSON.stringify([{ data: Array.from({ length: 21 }, (_, i) => [i, i % n]) }]);

test("a choice restored on reload draws at once, even while its size settles", async () => {
	const output = await packedMdx(dir, "restored", RESTORED);
	await inPage(output, async (cdp) => {
		await cdp.evaluate(`document.getElementById("n-1").click(), ${FRAMES}`, true);
		await motion(cdp);
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: WATCH_DRAWS });
		await cdp.load();
		const seen = await drawnOnArrival(cdp);
		const endpoints = [restoredSeries(3), restoredSeries(9)];
		expect(seen.at(-1)).toBe(endpoints[1]);
		expect(seen.every((data) => endpoints.includes(data))).toBe(true);

		// A positive control: the same observer must detect interpolated data after the reader acts.
		await cdp.evaluate(`window.plotDraws = []; ${READER}; document.getElementById("n-0").click()`);
		const moving = await drawnOnArrival(cdp);
		expect(moving.at(-1)).toBe(endpoints[0]);
		expect(moving.some((data) => !endpoints.includes(data))).toBe(true);
	});
}, 30_000);
