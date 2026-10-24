import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { KIT_DIR, SKILL_ROOT } from "./paths.ts";

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

/** A tsconfig for the author's current page directory, pointing at this skill's components and vendored declarations. */
export function authorTsconfig(): string {
	const types = join(SKILL_ROOT, "vendor/types");
	return JSON.stringify(
		{
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				moduleResolution: "bundler",
				lib: ["ESNext", "DOM", "DOM.Iterable"],
				jsx: "react-jsx",
				jsxImportSource: "preact",
				strict: true,
				noEmit: true,
				allowImportingTsExtensions: true,
				types: [],
				paths: {
					kit: [join(KIT_DIR, "components/index.ts")],
					preact: [join(types, "preact/src/index.d.ts")],
					"preact/*": [join(types, "preact/*/src/index.d.ts")],
					echarts: [join(types, "echarts/types/dist/echarts.d.ts")],
				},
			},
			files: [join(types, "globals.d.ts")],
			include: ["**/*.ts", "**/*.tsx"],
			exclude: [SKILL_ROOT],
		},
		null,
		2,
	);
}

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

/** Whether a resolved path is one of the kit's files (a part included) rather than a page's own. */
export const isKitFile = (path: string): boolean => path.startsWith(KIT_DIR + sep);

/**
 * The files a text file is made of. A kit file split by concern (a script, or theme.css) keeps its parts in `kit/parts/<name>/`;
 * they come first, in file name order, and the kit file itself last, so a page still includes one file. Any other file is itself.
 */
export function sourceFiles(path: string): string[] {
	const partsDir = join(KIT_DIR, "parts", basename(path, extname(path)));
	const parts =
		dirname(path) === KIT_DIR && existsSync(partsDir)
			? readdirSync(partsDir)
					.sort()
					.map((part) => join(partsDir, part))
			: [];
	return [...parts, path];
}

/**
 * A text file as a page receives it: its `sourceFiles` joined. Kit `.ts` sources become classic scripts, and the kit's CSS goes
 * into one `@layer kit`, its internal order kept, so any unlayered page rule wins over it whatever its specificity or place.
 * Any other file, a page's own included, is read as written.
 */
export function readKitText(path: string): string {
	const inKit = isKitFile(path);
	const text = sourceFiles(path)
		.map((file) => {
			const source = readFileSync(file, "utf8");
			return inKit && file.endsWith(".ts") ? script(source) : source;
		})
		.join("\n");
	return inKit && path.endsWith(".css") ? `@layer kit {\n${text.trimEnd()}\n}` : text;
}
