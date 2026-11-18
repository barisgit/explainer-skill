/* A responsive treemap's replacement data needs the same accent-label contrast as its base data. */
import { afterAll, expect, test } from "bun:test";
import { runKitPart } from "../skills/explainer/src/kit.ts";
import { packAndRun, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const kit = runKitPart("charts/defaults.ts", "ChartsDefaults") as {
	defaults(option: object): object;
};
const data = [
	{ name: "accent", value: 2, itemStyle: { color: "var(--accent)" } },
	{ name: "own", value: 1, itemStyle: { color: "var(--accent)" }, label: { color: "red" } },
];
for (const explicit of [false, true]) {
	test(`responsive treemap replacement data gets accent ink (${explicit ? "baseOption" : "root series"})`, () => {
		const base = { series: [{ type: "treemap", data }] };
		const media = [{ query: { maxWidth: 639 }, option: { series: [{ data }] } }];
		const actual = kit.defaults({ ...(explicit ? { baseOption: base } : base), media });
		expect(actual).toMatchObject({
			media: [
				{
					option: {
						series: [
							{ data: [{ label: { color: "var(--accent-ink)" } }, { label: { color: "red" } }] },
						],
					},
				},
			],
		});
		expect(data[0]).not.toHaveProperty("label");
	});
}

for (const key of ["id", "name"]) {
	for (const explicit of [false, true]) {
		test(`responsive defaults follow reordered ${key} series (${explicit ? "baseOption" : "root"})`, () => {
			const base = {
				series: [
					{ [key]: "red", type: "line", lineStyle: { color: "red" } },
					{ [key]: "other", type: "line" },
				],
			};
			const media = [{ option: { series: [{ [key]: "other" }, { [key]: "red" }] } }];
			expect(kit.defaults({ ...(explicit ? { baseOption: base } : base), media })).toEqual({
				...kit.defaults(explicit ? { baseOption: base } : base),
				media: [
					{
						option: {
							series: [
								{ [key]: "other", lineStyle: { type: [6, 4], cap: "round" } },
								{ [key]: "red" },
							],
						},
					},
				],
			});
		});
	}
}

test("identity matches reserve base slots before unnamed overrides, and a new id appends", () => {
	const base = {
		series: [
			{ id: 7, name: "coloured", type: "line", lineStyle: { color: "red" } },
			{ name: "plain", type: "line" },
		],
	};
	const cases = [
		{
			input: [null, {}, { id: "7" }],
			output: [null, { lineStyle: { type: [6, 4], cap: "round" } }, { id: "7" }],
		},
		{
			input: [{ name: "plain" }],
			output: [{ name: "plain", lineStyle: { type: [6, 4], cap: "round" } }],
		},
		{
			input: [{ id: "new", name: "plain", type: "line" }],
			output: [
				{ id: "new", name: "plain", type: "line", lineStyle: { type: [1, 4], cap: "round" } },
			],
		},
	];
	for (const { input, output } of cases) {
		expect(kit.defaults({ ...base, media: [{ option: { series: input } }] })).toEqual({
			...kit.defaults(base),
			media: [{ option: { series: output } }],
		});
	}
});

test("nullish series patches do not shift saved identities when a later update replays them", async () => {
	const page = `<!doctype html><html><head>
<link rel="stylesheet" href="kit:theme.css"></head><body><div class="chart" id="c"></div>
<script src="kit:echarts.js"></script><script src="kit:charts.js"></script>
<script>
var contract = (async () => {
	let handle;
	const chart = await new Promise(done => {
		handle = Charts.make(document.getElementById("c"), {
			xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: {},
			series: ["A", "B"].map(id => ({ id, type: "line", data: [1, 2, 3] }))
		}, done);
	});
	handle.set({ series: [null, undefined] });
	handle.set({ series: [{ id: "C", type: "line", data: [4, 5, 6] }] });
	handle.set({ series: [{}, {}, { data: [7, 8, 9] }] });
	const data = chart.getOption().series.map(s => [s.id, s.data]);
	handle.dispose();
	return JSON.stringify(data) === JSON.stringify([["A", [1,2,3]], ["B", [1,2,3]], ["C", [7,8,9]]])
		? [] : ["saved series drifted from ECharts: " + JSON.stringify(data)];
})();
</script></body></html>`;
	expect(await packAndRun(dir, "null-series", page)).toEqual([]);
}, 30_000);
