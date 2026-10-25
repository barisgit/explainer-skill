import { afterAll, describe, expect, test } from "bun:test";
import { packAndRun, packHtml, pageContract, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const KIT = '<link rel="stylesheet" href="kit:theme.css">';

test("a plain page rule overrides the kit, whatever its specificity or place, and the kit's fonts and media rules still apply", async () => {
	// The page's style comes before the kit's: an element selector against the kit's .page, and an equal selector earlier in order.
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>main { padding-block: 7px; } h1 em { color: rgb(1, 2, 3); }</style>${KIT}</head>
<body><main class="page"><h1>Plain <em id="em">rule</em></h1></main><script>${pageContract({
		"an element rule beats the kit's class rule": `getComputedStyle(document.querySelector("main")).paddingTop === "7px"`,
		"an earlier rule of equal specificity beats the kit's": `getComputedStyle(document.getElementById("em")).color === "rgb(1, 2, 3)"`,
		"the kit's @font-face loads": `[...document.fonts].some((f) => f.family.includes("Geist") && f.status === "loaded")`,
		"the kit's @media rules apply": `getComputedStyle(document.getElementById("em")).whiteSpace === (innerWidth >= 640 ? "nowrap" : "normal")`,
	})}</script></body></html>`;

	expect(await packAndRun(dir, "layer", page)).toEqual([]);
});

describe("pack warns when the page's own CSS styles a class the kit styles", () => {
	const OWN_TREE = "ul.tree { margin: 0; } .tree li { list-style: none; }";

	test.each([
		["<style>", `<style>${OWN_TREE}</style>`],
		["own.css", '<link rel="stylesheet" href="own.css">'],
	])("a page component named like a kit one, in %s", async (where, head) => {
		dir.write("own.css", OWN_TREE);
		const input = dir.write(
			"collide.html",
			`<!doctype html><html><head>${KIT}${head}</head><body><ul class="tree"><li>a</li></ul></body></html>`,
		);

		const { error, warnings } = await packHtml(input, dir.path("collide.out.html"));

		expect(error).toBe("");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(".tree");
		expect(warnings[0]).toContain(`"ul.tree" (${where})`);
		expect(warnings[0]).toContain("parts/theme/08-tree.css");
	});

	test("in the CSS an .mdx page imports, and not for the markup of the kit's components", async () => {
		dir.write("own-mdx.css", `${OWN_TREE} .mine { color: red; }`);
		const input = dir.write(
			"collide.mdx",
			`import "./own-mdx.css";
import { Question, Tree, View } from "kit";

# Own tree

<ul class="tree"><li>a</li></ul>

<Tree head={["Task", "Hours"]} items={[{ label: "One", cells: ["1 h"], text: "a" }]} />

<Question name="q" legend="Pick" options={{ a: "A", b: "B" }} />

<View name="v">

# V

</View>
`,
		);

		const result = await runCli(["pack", input, "-o", dir.path("collide-mdx.out.html")]);

		expect(result.code).toBe(0);
		const warnings = result.stdout.split("\n").filter((line) => line.startsWith("warning:"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('"ul.tree" (own-mdx.css)');
	});

	test("not for a page that uses kit classes in markup and styles only its own classes, variants, parts and children of kit ones", async () => {
		const input = dir.write(
			"no-collide.html",
			`<!doctype html><html><head>${KIT}<style>
.mine { color: red; } .chart.tall-mine { block-size: 30rem; } .compare th.num { text-align: end; } .stat dd { color: blue; }
.relax .bad { color: red; } .dg-own .node circle { fill: red; } :root { --accent: #123456; }
.tree { summary { color: red; } } .chart { &.tall-mine { color: red; } } .tree::before { content: ""; } .tree\\:wide { color: red; }
</style><template><style>.tree { color: red; }</style></template></head><body><main class="page"><div class="fig panel"><div class="chart tall-mine"></div></div>
<div class="tree"><details><summary><span>a</span><span>1</span></summary></details></div></main></body></html>`,
		);

		expect(await packHtml(input, dir.path("no-collide.out.html"))).toEqual({
			error: "",
			warnings: [],
		});
	});
});
