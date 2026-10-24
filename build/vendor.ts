#!/usr/bin/env bun
/**
 * Regenerates the vendored libraries from the pinned devDependencies:
 * (paths inside skills/explainer)
 *   kit/echarts.js                custom ECharts bundle (build/echarts-entry.ts), minified, one script tag
 *   vendor/beautiful-mermaid.js   beautiful-mermaid with ELK and entities, one ES module; used by `pack` to render diagrams, never inlined
 *   vendor/mdx.js                 the MDX compiler with remark-gfm and remark-frontmatter, one ES module; used by `pack` for .mdx pages, never inlined
 *   vendor/preact/*.js            Preact, its hooks and JSX runtime, and preact-render-to-string, as ES modules that import "preact";
 *                                 pack bundles them into a page's prerender and its client components
 *   vendor/types/                Preact, ECharts and kit declarations for author typechecking
 *   vendor/table-core.js          the TanStack Table parts the records core uses (build/table-core-entry.ts), one ES module,
 *                                 with vendor/table-core.d.ts naming the same exports
 *   kit/licenses/*.txt            licence texts the bundles must carry
 *   vendor/math.js                remark-math and Temml, one ES module; used by `pack` to render $...$ to MathML, never inlined
 *   kit/parts/math/temml.css      Temml's stylesheet for system math fonts, and kit/fonts/temml.woff2, the font it names;
 *                                 the start of kit:math.css, which pack adds to a page that holds math
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const skill = join(root, "skills", "explainer");
const nm = (...p: string[]) => join(root, "node_modules", ...p);
const text = (...p: string[]) => Bun.file(nm(...p)).text();
const versionOf = async (pkg: string): Promise<string> =>
	(await Bun.file(nm(pkg, "package.json")).json()).version;

/** Bundles one entry and returns its single output file's text and the files it was built from (relative to the repository). */
async function build(
	entry: string,
	target: "browser" | "bun",
	format: "iife" | "esm",
	external: string[] = [],
) {
	const built = await Bun.build({
		entrypoints: [entry],
		minify: true,
		target,
		format,
		external,
		metafile: true,
	});
	const [output] = built.outputs;
	if (!(built.success && output && built.metafile)) {
		throw new Error(`${entry}: ${built.logs.join("\n")}`);
	}
	return { text: await output.text(), inputs: Object.keys(built.metafile.inputs) };
}

const bundle = async (...args: Parameters<typeof build>) => (await build(...args)).text;

const echartsHeader = `/* echarts: Apache ECharts ${await versionOf("echarts")}, custom build, global echarts.
   Charts: line bar scatter pie heatmap treemap sankey sunburst radar boxplot. Components: grid polar radar calendar axisPointer tooltip legend
   dataZoom brush toolbox visualMap markLine/Area/Point title dataset transform aria. Features: label layout, universal transition. Canvas renderer.
   Apache-2.0, licenses/echarts.txt. Rebuild with: bun run vendor */\n`;
writeFileSync(
	join(skill, "kit/echarts.js"),
	echartsHeader + (await bundle(join(import.meta.dir, "echarts-entry.ts"), "browser", "iife")),
);

// The minifier drops ELK's own notice comments, so the header restates them (EPL-2.0 section 3.3) and points at the licence files.
const [bm, elk, entities] = await Promise.all(
	["beautiful-mermaid", "elkjs", "entities"].map(versionOf),
);
const mermaidHeader = `/*! beautiful-mermaid ${bm} (MIT, Copyright (c) 2026 Craft Docs) with patches/beautiful-mermaid@${bm}.patch, bundled with
   elkjs ${elk} (EPL-2.0, Copyright (c) 2017, 2021 Kiel University and others; source: https://github.com/kieler/elkjs/tree/${elk},
   which builds on https://github.com/eclipse/elk) and entities ${entities} (BSD-2-Clause, Copyright (c) Felix Böhm).
   Each component keeps its own licence; this file as a whole is not MIT. Texts: kit/licenses/beautiful-mermaid.txt, elkjs.txt, entities.txt.
   Exports renderMermaidSVG and parseMermaid. Rebuild with: bun run vendor */\n`;
mkdirSync(join(skill, "vendor"), { recursive: true });
writeFileSync(
	join(skill, "vendor/beautiful-mermaid.js"),
	mermaidHeader + (await bundle(join(import.meta.dir, "beautiful-mermaid-entry.ts"), "bun", "esm")),
);

/**
 * The licence notices of every package a bundle was built from, one after another: name, version and licence, then the package's
 * own licence file (or, for a package that ships none, the author its package.json names).
 */
async function packageLicences(inputs: string[]): Promise<string[]> {
	const dirs = new Set(
		inputs.flatMap((input) => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1] ?? []),
	);
	const notices = await Promise.all(
		[...dirs].sort().map(async (dir) => {
			const pkg = await Bun.file(join(root, dir, "package.json")).json();
			const licence = pkg.license ?? pkg.licenses?.map((l: { type: string }) => l.type).join(", ");
			const file = readdirSync(join(root, dir)).find((name) => /^licen[cs]e(\.\w+)?$/i.test(name));
			const body = file
				? await Bun.file(join(root, dir, file)).text()
				: `No licence file in the package; package.json: license ${licence}, author ${JSON.stringify(pkg.author)}.`;
			return `${pkg.name} ${pkg.version} (${licence})\n\n${body.trim()}`;
		}),
	);
	return notices;
}

// The MDX compiler is many small unified packages: one notice file lists them all.
const mdx = await build(join(import.meta.dir, "mdx-entry.ts"), "bun", "esm");
const mdxNotices = await packageLicences(mdx.inputs);
const mdxHeader = `/*! @mdx-js/mdx ${await versionOf("@mdx-js/mdx")} with remark-gfm ${await versionOf("remark-gfm")} and remark-frontmatter ${await versionOf("remark-frontmatter")},
   bundled with the unified packages they use, each under its own licence. Their texts: kit/licenses/mdx.txt.
   Exports compile, remarkGfm and remarkFrontmatter. Used by pack for .mdx pages, never inlined. Rebuild with: bun run vendor */\n`;
writeFileSync(join(skill, "vendor/mdx.js"), mdxHeader + mdx.text);

// Preact stays a set of ES modules importing "preact", so pack can bundle one Preact instance into a page's prerender and its client code.
const preactVersion = await versionOf("preact");
const renderVersion = await versionOf("preact-render-to-string");
const preactModules: Record<string, [name: string, entry: string]> = {
	"preact.js": [`preact ${preactVersion}`, "preact/dist/preact.module.js"],
	"hooks.js": [`preact/hooks ${preactVersion}`, "preact/hooks/dist/hooks.module.js"],
	"jsx-runtime.js": [
		`preact/jsx-runtime ${preactVersion}`,
		"preact/jsx-runtime/dist/jsxRuntime.module.js",
	],
	"render-to-string.js": [
		`preact-render-to-string ${renderVersion}`,
		"preact-render-to-string/dist/index.module.js",
	],
};
rmSync(join(skill, "vendor/preact"), { recursive: true, force: true });
mkdirSync(join(skill, "vendor/preact"));
for (const [file, [name, entry]] of Object.entries(preactModules)) {
	writeFileSync(
		join(skill, "vendor/preact", file),
		`/*! ${name}, MIT licence: kit/licenses/preact.txt */\n${await bundle(nm(entry), "browser", "esm", ["preact"])}`,
	);
}

// Author typechecking uses the same public types as the kit, with the libraries' own declarations, without node_modules.
const declarations = [
	"preact/src/index.d.ts",
	"preact/src/jsx.d.ts",
	"preact/src/dom.d.ts",
	"preact/hooks/src/index.d.ts",
	"preact/jsx-runtime/src/index.d.ts",
	"preact-render-to-string/dist/index.d.ts",
	"echarts/types/dist/echarts.d.ts",
];
for (const file of declarations) {
	const out = join(skill, "vendor/types", file);
	mkdirSync(join(out, ".."), { recursive: true });
	copyFileSync(nm(file), out);
}
copyFileSync(join(root, "kit-types/globals.d.ts"), join(skill, "vendor/types/globals.d.ts"));

const [table, store] = await Promise.all(
	["@tanstack/table-core", "@tanstack/store"].map(versionOf),
);
const tableEntry = join(import.meta.dir, "table-core-entry.ts");
const tableHeader = `/*! @tanstack/table-core ${table} (MIT, Copyright (c) 2016 Tanner Linsley) with @tanstack/store ${store} (MIT, Copyright (c) 2021
   Tanner Linsley): sorting, filtering, global filtering, grouping, aggregation and faceting, for the records core (kit/records).
   Texts: kit/licenses/tanstack.txt. Rebuild with: bun run vendor */\n`;
writeFileSync(
	join(skill, "vendor/table-core.js"),
	tableHeader + (await bundle(tableEntry, "browser", "esm")),
);
// The entry is the list of exports; as a declaration file it re-exports their types from the same pinned package.
writeFileSync(
	join(skill, "vendor/table-core.d.ts"),
	`/** Types for vendor/table-core.js, written by build/vendor.ts from build/table-core-entry.ts. */\n${(await Bun.file(tableEntry).text()).replace(/^\/\*\*[\s\S]*?\*\/\n/, "")}`,
);

mkdirSync(join(skill, "kit/licenses"), { recursive: true });
const licences: Record<string, Promise<string>[]> = {
	"echarts.txt": [text("echarts", "LICENSE"), text("echarts", "NOTICE")],
	"beautiful-mermaid.txt": [text("beautiful-mermaid", "LICENSE")],
	// EPL-2.0 section 3.1(a): the object code must say where its source is available under the same licence.
	"elkjs.txt": [
		Promise.resolve(
			`elkjs ${elk}, Copyright (c) 2017, 2021 Kiel University and others.\nSPDX-License-Identifier: EPL-2.0\n\nvendor/beautiful-mermaid.js contains elkjs ${elk} (lib/elk.bundled.js) in minified form, unmodified.\nIts Source Code is available under the Eclipse Public License 2.0 at https://github.com/kieler/elkjs/tree/${elk}\n(the npm package elkjs@${elk}), and the Java sources it is compiled from at https://github.com/eclipse/elk.`,
		),
		text("elkjs", "LICENSE.md"),
	],
	"entities.txt": [text("entities", "LICENSE")],
	"mdx.txt": [
		Promise.resolve(
			`vendor/mdx.js bundles these ${mdxNotices.length} packages; each keeps its own licence.\n\n${mdxNotices.join(`\n\n${"-".repeat(72)}\n\n`)}`,
		),
	],
	"preact.txt": [
		text("preact", "LICENSE").then((licence) => `preact ${preactVersion}\n\n${licence.trim()}`),
		text("preact-render-to-string", "LICENSE").then(
			(licence) => `preact-render-to-string ${renderVersion}\n\n${licence.trim()}`,
		),
	],
	"tanstack.txt": [
		Promise.resolve(`@tanstack/table-core ${table}`),
		text("@tanstack/table-core", "LICENSE"),
		Promise.resolve(`@tanstack/store ${store}`),
		text("@tanstack/store", "LICENSE"),
	],
};
for (const [file, parts] of Object.entries(licences)) {
	writeFileSync(join(skill, "kit/licenses", file), (await Promise.all(parts)).join("\n\n"));
}

for (const f of [
	"kit/echarts.js",
	"vendor/beautiful-mermaid.js",
	"vendor/table-core.js",
	"vendor/mdx.js",
	...Object.keys(preactModules).map((file) => `vendor/preact/${file}`),
]) {
	console.log(`${f} ${(statSync(join(skill, f)).size / 1024).toFixed(0)} KB`);
}

/**
 * Math: remark-math and Temml as one module for pack, and Temml's stylesheet with its font as the start of kit:math.css. The
 * stylesheet is Temml-Local.css (system math fonts, no 380 KB Latin Modern): its fixes for each browser's MathML gaps (\overline,
 * \boxed, \cancel and array alignment in Chromium, accents in WebKit) are worth keeping whole, and Temml.woff2 (9 KB, a clone of
 * KaTeX_Script with Unicode code points) sets primes and \mathscr, which system math fonts place badly in Chromium.
 */
async function vendorMath() {
	const math = await build(join(import.meta.dir, "math-entry.ts"), "bun", "esm");
	const notices = await packageLicences(math.inputs);
	const [temml, remarkMath] = await Promise.all(["temml", "remark-math"].map(versionOf));
	writeFileSync(
		join(skill, "vendor/math.js"),
		`/*! temml ${temml} and remark-math ${remarkMath}, bundled with the micromark and mdast packages remark-math uses, each under its own licence.
   Their texts: kit/licenses/math.txt. Exports remarkMath and temml. Used by pack for .mdx pages, never inlined. Rebuild with: bun run vendor */\n${math.text}`,
	);
	const font = "url('Temml.woff2')";
	const css = await text("temml", "dist", "Temml-Local.css");
	if (!css.includes(font)) {
		throw new Error(
			`temml ${temml}: Temml-Local.css no longer loads ${font}; update the path rewrite below`,
		);
	}
	mkdirSync(join(skill, "kit/parts/math"), { recursive: true });
	writeFileSync(
		join(skill, "kit/parts/math/temml.css"),
		`/* temml ${temml} dist/Temml-Local.css, its font path set to the kit's fonts/. MIT, kit/licenses/math.txt. Rebuild with: bun run vendor */\n${css.replace(font, "url('fonts/temml.woff2')")}`,
	);
	copyFileSync(nm("temml", "dist", "Temml.woff2"), join(skill, "kit/fonts/temml.woff2"));
	const katexFonts = await text("katex", "LICENSE");
	writeFileSync(
		join(skill, "kit/licenses/math.txt"),
		`vendor/math.js bundles these ${notices.length} packages; each keeps its own licence. kit/parts/math/temml.css and\nkit/fonts/temml.woff2 come from temml (below). temml.woff2 is a clone of KaTeX_Script-Regular from the KaTeX fonts,\nwhose licence follows the package list.\n\n${[...notices, `KaTeX fonts\n\n${katexFonts.trim()}`].join(`\n\n${"-".repeat(72)}\n\n`)}`,
	);
	for (const f of ["vendor/math.js", "kit/parts/math/temml.css", "kit/fonts/temml.woff2"]) {
		console.log(`${f} ${(statSync(join(skill, f)).size / 1024).toFixed(0)} KB`);
	}
}
await vendorMath();
