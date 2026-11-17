import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { authorTsconfig } from "../skills/explainer/src/kit.ts";
import { LINKS_JS } from "../skills/explainer/src/link-probes.ts";
import { DISCOVER_JS } from "../skills/explainer/src/page-probes.ts";
import { parseNetlist } from "../skills/explainer/src/schematic/netlist.ts";
import { placeParts } from "../skills/explainer/src/schematic/place.ts";
import { inPage, packedMdx, packMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

test("Markdown destinations cannot silently retain expression braces", async () => {
	const { result } = await packMdx(dir, "destination", "# Links\n\n[x](#package/{id})\n");
	expect(result.code).toBe(1);
	expect(result.stderr).toContain("<a href={...}>");
	const good = await packedMdx(
		dir,
		"jsx-link",
		`# Links\n\n<a href={\`#package/\${"one"}\`}>One</a>\n`,
	);
	expect(readFileSync(good, "utf8")).toContain('href="#package/one"');
});

test("check rejects absent filled records and unknown routes instead of discovering them", async () => {
	const output = await packedMdx(
		dir,
		"routes",
		`import { View } from "kit";
import { Item } from "./item.tsx";

# Routes

[Good](#package/one) [Missing](#package/absent) [Braces](#package/%7Bid%7D) [Unknown](#other/one) [No record](#package)

<View name="package" records={[{id: "one"}]} render={Item} />
`,
		{ "item.tsx": '"use client"; export function Item({record}) { return <h1>{record.id}</h1>; }' },
	);
	const result = await inPage(output, async (cdp) => ({
		links: await cdp.evaluate<{ problems: string[] }>(LINKS_JS),
		views: await cdp.evaluate<{ hashes: string[] }>(DISCOVER_JS),
	}));
	expect(result.links.problems).toHaveLength(4);
	expect(result.links.problems.join("\n")).toContain("#package/absent");
	expect(result.links.problems.join("\n")).toContain("#package/%7Bid%7D");
	expect(result.views.hashes).toEqual(["#package/one"]);
	const checked = await runCli(["check", output, "--quick", "--out", dir.path("routes-shots")]);
	expect(checked.code).toBe(1);
	expect(checked.stdout).toContain('missing in-page link target: href="#package/absent"');
	expect(checked.stdout).not.toContain("view #package/absent");
}, 30_000);

test("Explore choices cannot join a Question's radio group", async () => {
	const { result } = await packMdx(
		dir,
		"groups",
		`import { Explore, Question } from "kit";

# Groups

<Explore label="Size" controls={[{id: "size", label: "Size", choice: ["5 kWh", "10 kWh"]}]} frame={() => ({readout: "Size"})} />

<Question name="size" legend="Which size?" options={["5 kWh", "10 kWh"]} note />\n\n<input type="checkbox" name="kept" />\n\n<Question name="kept" legend="Keep?" options={["Yes"]} multiple />
`,
	);
	expect(result.code).toBe(1);
	expect(result.stderr).toContain('Question name="size"');
	expect(result.stderr).not.toContain('name="kept"');
	expect(result.stderr).toContain('name="size" outside');
});

test("a net mistaken for a part kind gives an explicit-kind repair", () => {
	const deliberate = parseNetlist("V1 isource a 0 @0,0\nR1 a 0 1k a@V1.z");
	expect(placeParts(deliberate.parts).join("\n")).not.toContain("read as the part kind");
	const parsed = parseNetlist("U1 ic MCU right SDA=sda @0,0\nR_SDA vdd sda 10k b@U1.SDA 3,-3 v");
	expect(parsed.errors).toEqual([]);
	expect(placeParts(parsed.parts).join("\n")).toContain("R_SDA resistor vdd");
	const fixed = parseNetlist(
		"U1 ic MCU right SDA=sda @0,0\nR_SDA resistor vdd sda 10k b@U1.SDA 3,-3 v",
	);
	expect(placeParts(fixed.parts)).toEqual([]);
});

test("author types use the repository's browser strictness", () => {
	const config = JSON.parse(authorTsconfig(dir.path(""), []));
	const root = JSON.parse(
		readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8").replace(/\/\/[^\n]*/g, ""),
	);
	for (const [key, value] of Object.entries(root.compilerOptions)) {
		if (!["types", "noPropertyAccessFromIndexSignature"].includes(key)) {
			expect(config.compilerOptions[key]).toEqual(value);
		}
	}
});
