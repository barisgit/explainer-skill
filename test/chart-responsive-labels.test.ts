/* A responsive treemap's replacement data needs the same accent-label contrast as its base data. */
import { expect, test } from "bun:test";
import { runKitPart } from "../skills/explainer/src/kit.ts";

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
