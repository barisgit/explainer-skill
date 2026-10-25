import { readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { PackError } from "../pack-error.ts";
import { shownPath } from "../paths.ts";
import { compileMdx } from "./compile.ts";

/** The module types a typechecker reads; data (.json) and styles (.css) come in through these. */
const CODE = new Set([".ts", ".tsx", ".mts", ".js", ".jsx"]);

const scanner = new Bun.Transpiler({ loader: "js" });

/** The file a page's relative import names, resolved as the bundler does (an extension may be left out). */
function resolveImport(specifier: string, page: string): string {
	try {
		return Bun.resolveSync(specifier, dirname(page));
	} catch {
		throw new PackError(`${shownPath(page)} imports ${specifier}, which does not exist`);
	}
}

/**
 * The code files the .mdx pages in `dir` import, directly or through an imported .mdx fragment, as absolute paths in the order
 * the pages name them: the page's own sources, which `kit types` hands the typechecker (it follows their imports itself), and
 * not the scripts or scratch files that happen to lie beside the page. Throws PackError for a page pack could not read either.
 */
export async function pageSources(dir: string): Promise<string[]> {
	const pages = readdirSync(dir)
		.filter((name) => extname(name) === ".mdx")
		.sort()
		.map((name) => join(dir, name));
	const seen = new Set<string>(pages);
	const sources = new Set<string>();
	for (const page of pages) {
		const { js } = await compileMdx(page, false);
		for (const { path: specifier } of scanner.scanImports(js)) {
			if (!specifier.startsWith(".")) {
				continue;
			}
			const path = resolveImport(specifier, page);
			if (extname(path) === ".mdx" && !seen.has(path)) {
				seen.add(path);
				pages.push(path);
			} else if (CODE.has(extname(path))) {
				sources.add(path);
			}
		}
	}
	return [...sources];
}
