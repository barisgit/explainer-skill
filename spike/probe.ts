/* Spike probe: renders a definition's scene in Bun (no DOM) and prints the interaction points at one x. */
import { createChartRuntime } from "@tanstack/charts";
import { heroChart } from "./tanstack/fourier-charts.ts";

const runtime = createChartRuntime();
const scene = runtime.render(heroChart("square", 9, true), { width: 720, height: 400 });
console.log(Object.keys(scene));
const x0 = scene.points[0]?.xValue;
const at = scene.points.filter(
	(p) => p.xValue === scene.points.find((q) => q.groupLabel === "3× sine")?.xValue,
);
console.log(scene.points.length, x0, Object.keys(scene.points[0] ?? {}));
console.log(at.map((p) => [p.groupLabel, p.yValue, p.key, p.markId]));

import { focusGroupX } from "@tanstack/charts/focus";

const p = scene.points.find(
	(q) => q.groupLabel === "3× sine" && Math.abs((q.xValue as number) + 6.2652) < 1e-3,
);
if (p) {
	const group = focusGroupX.group(scene.points, { point: p });
	console.log(
		"group at",
		p.xValue,
		group.map((g) => [g.groupLabel, g.yValue.toFixed(3)]),
	);
}
const xs = -6.265220517166206;
console.log(
	"direct",
	scene.points
		.filter((q) => q.xValue === xs)
		.map((q) => [
			q.groupLabel,
			(q.yValue as number).toFixed(3),
			q.datumIndex,
			(q.datum as { y: number }).y.toFixed(3),
		]),
);
if (p) {
	const group = focusGroupX.group(scene.points, { point: p });
	console.log(
		group.map((g) => [
			g.groupLabel,
			g.datumIndex,
			(g.datum as { y: number }).y.toFixed(3),
			g.yValue,
		]),
	);
}
