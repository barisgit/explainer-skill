import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../skills/explainer/src/check.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const file = dir.write(
	"sizes.html",
	`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { margin: 0; }
@media (width: 1920px) and (height: 1080px) { #probe { width: 1950px; } }
</style>
<h1>Viewport test</h1>
<button id="resize" onclick="document.querySelector('#probe').style.height = '240px'">Resize</button>
<div id="probe" style="height: 80px">Probe</div>`,
);

function pngSize(path: string) {
	const png = readFileSync(path);
	return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("repeatable custom viewports check layout and capture first screens and step states in both themes", async () => {
	const out = dir.path("sizes");
	const result = await runCli([
		"check",
		file,
		"--viewport",
		"1920x1080",
		"--viewport",
		"900x700",
		"--viewport",
		"1920x1080",
		"--do",
		"click:#resize",
		"--do",
		"shot:#probe",
		"--out",
		out,
		"--json",
	]);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(1);
	const { shots, stepNotes } = JSON.parse(result.stdout) as CheckResult;
	expect(shots).toHaveLength(8);
	for (const theme of ["light", "dark"]) {
		for (const [width, height] of [
			[1920, 1080],
			[900, 700],
		] as const) {
			const size = `${width}x${height}`;
			const shot = shots.find((s) => s.theme === theme && s.viewport === size);
			if (!shot?.first) {
				throw new Error(`No first screen for ${theme} ${size}`);
			}
			expect(pngSize(shot.first.png)).toEqual([width, height]);
			expect(shot.png).toBe(join(out, `sizes-${theme}-${size}.png`));
			expect(shot.problems.some((p) => p.includes("horizontal page overflow"))).toBe(
				width === 1920,
			);
			expect(shot.elements.map((e) => [e.png, pngSize(e.png)[1]])).toEqual([
				[join(out, `sizes-shot1-probe-${theme}-${size}.png`), 240],
			]);
			expect(stepNotes).toContain(`click:#resize: hit button#resize [${theme} ${size}]`);
		}
	}
}, 30_000);

test.each(["0x800", "800x1.5", "800xNaN", "10000001x800"])(
	"check rejects invalid viewport %s before starting Chrome",
	async (size) => {
		const result = await runCli(["check", file, "--viewport", size]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain(`--viewport takes a width and height`);
		expect(result.stderr).toContain(size);
	},
);
