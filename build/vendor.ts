#!/usr/bin/env bun
/**
 * Regenerates the vendored libraries from the pinned devDependencies:
 * (paths inside skills/explainer)
 *   kit/echarts.js                custom ECharts bundle (build/echarts-entry.ts), minified, one script tag
 *   vendor/beautiful-mermaid.js   beautiful-mermaid with ELK and entities, one ES module; used by `pack` to render diagrams, never inlined
 *   vendor/mdx.js                 the MDX compiler with remark-gfm and remark-frontmatter, one ES module; used by `pack` for .mdx pages, never inlined
 *   vendor/preact/*.js            Preact, its hooks and JSX runtime, and preact-render-to-string, as ES modules that import "preact";
 *                                 pack bundles them into a page's prerender and its client components
 *   kit/licenses/*.txt            licence texts the bundles must carry
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
};
for (const [file, parts] of Object.entries(licences)) {
	writeFileSync(join(skill, "kit/licenses", file), (await Promise.all(parts)).join("\n\n"));
}

for (const f of [
	"kit/echarts.js",
	"vendor/beautiful-mermaid.js",
	"vendor/mdx.js",
	...Object.keys(preactModules).map((file) => `vendor/preact/${file}`),
]) {
	console.log(`${f} ${(statSync(join(skill, f)).size / 1024).toFixed(0)} KB`);
}
