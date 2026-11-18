import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { inPage, runCli, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("legend rescaling places ticks at once while the series still eases, in both schemes and widths", async () => {
	const output = dir.path("all.html");
	const result = await runCli([
		"pack",
		join(import.meta.dir, "fixtures/mdx-all/page.mdx"),
		"-o",
		output,
	]);
	expect(result.code).toBe(0);
	for (const viewport of WIDTHS) {
		for (const scheme of ["light", "dark"]) {
			const samples = await inPage(
				output,
				async (cdp) => {
					await cdp.send("Emulation.setEmulatedMedia", {
						features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
					});
					const frames = await cdp.evaluate<{ ticks: string; moving: boolean }[]>(
						`(async () => {
					document.documentElement.dataset.scheme = "${scheme}";
					const el = document.querySelector('[aria-label="Monthly production and use"]');
					el.scrollIntoView({ block: "center" });
					await new Promise(requestAnimationFrame);
					const chart = echarts.getInstanceByDom(el);
					chart.setOption({ animation: true });
					const ticks = () => chart.getZr().storage.getDisplayList().filter((el) => / kWh$/.test(el.style?.text ?? "")).map((el) => {
						const r = el.getBoundingRect().clone(); r.applyTransform(el.getComputedTransform());
						return [el.style.text, r.x, r.y, r.height];
					});
					const seriesMoves = () => {
						let moving = false;
						chart.getViewOfSeriesModel(chart.getModel().getSeriesByIndex(1)).group.traverse((el) => { moving ||= el.animators.length > 0; });
						return moving;
					};
					chart.dispatchAction({ type: "legendToggleSelect", name: "Produced" });
					const start = performance.now(), frames = [];
					do {
						await new Promise(requestAnimationFrame);
						frames.push({ ticks: JSON.stringify(ticks()), moving: seriesMoves() });
					} while (performance.now() - start < 650);
					return frames;
				})()`,
						true,
					);
					expect(
						await cdp.evaluate(`(() => {
						const chart = echarts.getInstanceByDom(document.querySelector('[aria-label="Monthly production and use"]'));
						chart.setOption({ yAxis: [{ animationDurationUpdate: 120 }] });
						return chart.getModel().getComponent("yAxis").get("animationDurationUpdate");
					})()`),
					).toBe(120);
					return frames;
				},
				viewport,
			);
			expect(samples.length).toBeGreaterThan(2);
			expect(JSON.parse(samples[0]?.ticks ?? "[]").length).toBeGreaterThan(3);
			expect(new Set(samples.map((s) => s.ticks)).size).toBe(1);
			expect(samples.some((s) => s.moving)).toBe(true);
		}
	}
}, 60_000);
