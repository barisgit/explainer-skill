import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
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

/** A kit script's English texts: its `const LABELS = {` block, one `key: "Text",` line per kitLabels key. */
const LABELS_BLOCK = /^\s*const LABELS = \{\n([\s\S]*?)\n\s*\};$/m;
const LABEL_LINE = /^\s*(\w+): ("(?:[^"\\]|\\.)*"),$/;

/**
 * The texts the kit scripts add, by script ("reply.js"): each one's kitLabels keys with their English text, read from the
 * script's LABELS object, which is where the script itself takes its defaults from. A LABELS line in another form throws, so
 * `kit labels` and pack's key check never miss a key silently.
 */
export function kitLabels(): { file: string; labels: Record<string, string> }[] {
	return kitFiles().flatMap((file) => {
		const path = kitPath(file);
		const block = path.endsWith(".ts")
			? LABELS_BLOCK.exec(readFileSync(path, "utf8"))?.[1]
			: undefined;
		if (block === undefined) {
			return [];
		}
		const entries = block.split("\n").map((line) => {
			const [, key, text] = LABEL_LINE.exec(line) ?? [];
			if (key === undefined || text === undefined) {
				throw new Error(
					`kit ${file}: write each LABELS entry as key: "Text", on its own line, not ${line.trim()}`,
				);
			}
			return [key, JSON.parse(text) as string] as const;
		});
		return [{ file, labels: Object.fromEntries(entries) }];
	});
}

/**
 * A tsconfig for the author's page directory `dir` that checks `sources` (the files the pages import, see mdx/sources.ts) and what
 * they import, as browser code: `kit`, Preact and ECharts resolve to this skill's components and vendored declarations, so
 * `bun check` needs no install. Nothing else beside the page (a Bun script, a scratch file) is checked.
 */
export function authorTsconfig(dir: string, sources: string[]): string {
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
				resolveJsonModule: true,
				types: [],
				paths: {
					kit: [join(KIT_DIR, "components/index.ts")],
					preact: [join(types, "preact/src/index.d.ts")],
					"preact/*": [join(types, "preact/*/src/index.d.ts")],
					"preact-render-to-string": [join(types, "preact-render-to-string/dist/index.d.ts")],
					echarts: [join(types, "echarts/types/dist/echarts.d.ts")],
				},
			},
			files: [join(types, "globals.d.ts"), ...sources.map((file) => relative(dir, file))],
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
