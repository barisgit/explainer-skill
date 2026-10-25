import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { relative } from "node:path";
import { packMdx, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>`;

/** A client component that shows `img` only after a click, so the prerendered page does not hold it. */
const reveal = (head: string, img: string) => `"use client";
import { useState } from "preact/hooks";
${head}
export function Reveal({ icon }: { icon?: string }) {
	const [open, setOpen] = useState(false);
	return <div><button type="button" id="show" onClick={() => setOpen(true)}>Show</button>{open && ${img}}</div>;
}
`;

/** A filled view's renderer that draws each record's icon. */
const BADGE = `"use client";
export function Badge({ record }: { record: { id: string; icon: string } }) {
	return <><h1>{record.id}</h1><section><h2>Icon</h2><img src={record.icon} alt="icon" /></section></>;
}
`;

/** A page with Reveal (given `props`) and a filled view of `records` drawn by Badge; `imports` come first. */
const page = (records: string, imports = "", props = "") => `import { View } from "kit";
import { Reveal } from "./reveal.tsx";
import { Badge } from "./badge.tsx";
${imports}

# Icons

A [badge](#badge/a).

<Reveal${props} />

<View name="badge" records={${records}} render={Badge} back="Icons" />
`;

describe("files that client code shows", () => {
	test("an image the client code imports is embedded, so the moved page loads nothing after a click or in a filled view", async () => {
		const { result } = await packMdx(
			dir,
			"imported",
			page("badges", 'import { badges } from "./badges.ts";'),
			{
				"icon.svg": ICON,
				"reveal.tsx": reveal('import icon from "./icon.svg";', '<img src={icon} alt="icon" />'),
				"badge.tsx": BADGE,
				"badges.ts": 'import icon from "./icon.svg";\nexport const badges = [{ id: "a", icon }];\n',
			},
		);
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		const moved = dir.path("moved/imported.html");
		expect((await runCli(["pack", dir.path("imported.mdx"), "-o", moved])).code).toBe(0);
		expect(readFileSync(moved, "utf8")).not.toContain("icon.svg");
		const checked = await runCli([
			"check",
			moved,
			"--quick",
			"--do",
			"click:#show",
			"--view",
			"all",
			"--out",
			dir.path("shots"),
		]);
		expect(checked.stdout).toContain("0 problems");
		expect(checked.code).toBe(0);
	}, 90_000);

	test("pack fails, saying to import it, for a file the client code names by path", async () => {
		const failures = await Promise.all(
			[
				["literal", '<img src="./icon.svg" alt="icon" />', "[]"],
				["template", `<img src={\`./icons/\${String(open)}.svg\`} alt="icon" />`, "[]"],
				["prop", '<img src={icon} alt="icon" />', "[]", ' icon="./icon.svg"'],
				["record", "null", '[{ id: "a", icon: "icon.svg" }]'],
				["remote", "null", '[{ id: "a", icon: "https://example.com/i.svg" }]'],
			].map(async ([name, img, records, props]) => {
				// Each page in its own directory, as the pages pack at once and import the same names.
				const { result } = await packMdx(dir, `${name}/page`, page(records ?? "", "", props), {
					[`${name}/icon.svg`]: ICON,
					[`${name}/badge.tsx`]: BADGE,
					[`${name}/reveal.tsx`]: reveal("", img ?? ""),
				});
				return [result.code, result.stderr.trim().split("\n").slice(1)];
			}),
		);
		/** The reveal.tsx of case `name` as pack names it: relative to the directory it runs in. */
		const shown = (name: string) =>
			relative(process.cwd(), realpathSync(dir.path(`${name}/reveal.tsx`)));
		const fix =
			'Fix: save the file next to the page and import it where it is used (import icon from "./icon.svg", then src={icon}): pack embeds an imported image or font.';
		expect(failures).toEqual([
			[
				1,
				[
					`- ${shown("literal")}: src "./icon.svg" is a file the browser would load when the code runs`,
					fix,
				],
			],
			[
				1,
				[
					`- ${shown("template")}: src "./icons/…" is a file the browser would load when the code runs`,
					fix,
				],
			],
			[
				1,
				['- <Reveal icon>: "./icon.svg" is a file the browser would load when the code runs', fix],
			],
			[1, ["- #badge/a: <img src> loads icon.svg", fix]],
			[1, ["- #badge/a: <img src> loads https://example.com/i.svg", fix]],
		]);
	}, 60_000);

	test("pack fails for an imported file it cannot embed", async () => {
		const { result } = await packMdx(
			dir,
			"video",
			'import clip from "./clip.mp4";\n\n# Clip\n\n<video src={clip} />\n',
			{
				"clip.mp4": "not really a video",
			},
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			"the page imports clip.mp4, which pack cannot embed: it embeds imported images (.png, .jpg, .jpeg, .gif, .webp, .svg, .avif) and fonts (.woff2, .woff, .ttf, .otf)",
		);
	}, 30_000);
});
