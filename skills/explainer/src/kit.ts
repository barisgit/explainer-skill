import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { KIT_DIR } from "./paths.ts";

/**
 * Kit scripts are TypeScript sources (erasable syntax only) that pages name with a `.js` extension: `kit:steps.js` is `kit/steps.ts`
 * with its types stripped. Everything else in kit/ is served as it is.
 */
const sourceName = (name: string) => (name.endsWith(".js") ? `${name.slice(0, -3)}.ts` : name);

/** The kit file a page names, as it lies in kit/ (the `.ts` source of a script when there is one). */
export function kitPath(name: string): string {
	const source = join(KIT_DIR, sourceName(name));
	return existsSync(source) ? source : join(KIT_DIR, name);
}

/** The kit files as pages name them, sorted. */
export const kitFiles = (): string[] =>
	readdirSync(KIT_DIR, { withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => (e.name.endsWith(".ts") ? `${e.name.slice(0, -3)}.js` : e.name))
		.sort();

/** The first block comment of a source file, markers included: a kit script's documentation. */
export const leadingComment = (source: string): string =>
	/^\s*\/\*[\s\S]*?\*\//.exec(source)?.[0] ?? "";

/**
 * The comment-free classic script a kit source becomes. Bun's transpiler drops every comment, so the documentation comment is put
 * back in front: a page's reader and `kit <file>` see the same text. A script stays a script: no module syntax is introduced.
 */
const transpiler = new Bun.Transpiler({ loader: "ts" });
const script = (source: string): string =>
	`${leadingComment(source).trim()}\n${transpiler.transformSync(source)}`;

/**
 * A text file as a page receives it. A kit file split by concern (a script, or theme.css) keeps its parts in `kit/parts/<name>/`;
 * they come first, in file name order, and the kit file itself last, so a page still includes one file.
 * Kit `.ts` sources become classic scripts; any other file, a page's own included, is read as written.
 */
export function readKitText(path: string): string {
	const partsDir = join(KIT_DIR, "parts", basename(path, extname(path)));
	const parts =
		dirname(path) === KIT_DIR && existsSync(partsDir)
			? readdirSync(partsDir)
					.sort()
					.map((part) => join(partsDir, part))
			: [];
	return [...parts, path]
		.map((file) => {
			const text = readFileSync(file, "utf8");
			// Only kit sources are TypeScript; a page's own scripts are served as written.
			return file.startsWith(KIT_DIR + sep) && file.endsWith(".ts") ? script(text) : text;
		})
		.join("\n");
}
