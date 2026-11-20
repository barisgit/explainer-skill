import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { inPage, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

interface JulyFrame {
	gridStartsAt: number;
	full: boolean;
}

/** Sample every redraw of the July figure, including the first one under reduced motion. */
const moveBattery = (cdp: Cdp, size: number) =>
	cdp.evaluate<JulyFrame[]>(
		`(async () => {
			const slider = document.querySelector("#battery");
			const area = slider.closest("section").querySelector(".plot-area > svg");
			const frames = [];
			const observer = new MutationObserver(() => {
				const grid = area.querySelector('path.area[style*="--c1"]');
				if (grid) frames.push({
					gridStartsAt: grid.getBBox().x,
					full: /battery\\s*full/.test(area.textContent),
				});
			});
			observer.observe(area, { childList: true });
			slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
			slider.value = ${size};
			slider.dispatchEvent(new Event("input", { bubbles: true }));
			await new Promise(done => setTimeout(done, 650));
			observer.disconnect();
			return frames;
		})()`,
		true,
	);

/** Whether the grid's evening fill started strictly between its two settled positions. */
const movedBetween = (frames: JulyFrame[], lower: number, upper: number) =>
	frames.some(({ gridStartsAt }) => gridStartsAt > lower && gridStartsAt < upper);

test("the July slider grows and shrinks battery coverage across zero, except under reduced motion (#190)", async () => {
	const output = dir.path("battery.html");
	const page = join(import.meta.dir, "../examples/battery/page.mdx");
	const packed = await runCli(["pack", page, "-o", output]);
	expect(packed.stderr).toBe("");
	expect(packed.code).toBe(0);
	await inPage(output, async (cdp) => {
		await moveBattery(cdp, 1);
		const stillZero = await moveBattery(cdp, 0);
		const stillOne = await moveBattery(cdp, 1);
		const zero = stillZero.at(-1);
		const one = stillOne.at(-1);
		if (!zero || !one) {
			throw new Error("the July slider did not redraw the grid area");
		}
		expect(zero.full).toBe(false);
		expect(one.full).toBe(true);
		expect(one.gridStartsAt).toBeGreaterThan(zero.gridStartsAt);
		expect(stillZero[0]).toEqual(zero);
		expect(stillOne[0]).toEqual(one);

		await cdp.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
		});
		const shrank = await moveBattery(cdp, 0);
		const grew = await moveBattery(cdp, 1);
		expect(shrank.at(-1)).toEqual(zero);
		expect(grew.at(-1)).toEqual(one);
		expect(
			[shrank, grew].map((frames) => movedBetween(frames, zero.gridStartsAt, one.gridStartsAt)),
		).toEqual([true, true]);
	});
}, 15_000);
