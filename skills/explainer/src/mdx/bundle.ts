import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, sep } from "node:path";
import type { BuildConfig, BunPlugin, JavaScriptLoader } from "bun";
import type { Island, renderPage } from "../../kit/islands/server.ts";
import { dataUri, EMBEDDED, MIME } from "../data-uri.ts";
import { PackError } from "../pack-error.ts";
import { KIT_DIR, SKILL_ROOT, shownPath } from "../paths.ts";
import { compileMdx } from "./compile.ts";
import { QUESTION_IMPORT, QUESTION_MODULE } from "./kit-scripts.ts";

/** The bare imports a page and the kit make, resolved to the skill's own files, so an installed skill needs no node_modules. */
const BARE: Record<string, string> = {
	preact: "vendor/preact/preact.js",
	"preact/hooks": "vendor/preact/hooks.js",
	"preact/jsx-runtime": "vendor/preact/jsx-runtime.js",
	"preact/jsx-dev-runtime": "vendor/preact/jsx-runtime.js",
	"preact-render-to-string": "vendor/preact/render-to-string.js",
	kit: "kit/components/index.ts",
};
const ISLANDS = join(KIT_DIR, "islands");
const LOADERS: Record<string, JavaScriptLoader> = {
	".ts": "ts",
	".mts": "ts",
	".tsx": "tsx",
	".js": "js",
	".mjs": "js",
	".jsx": "jsx",
};
const SCRIPT = /\.m?[jt]sx?$/;
/** The images and fonts a module may import: each becomes its data: URI, so the page and its client code carry the file. */
const EMBEDDABLE = new RegExp(
	`\\.(?:${Object.keys(MIME)
		.map((ext) => ext.slice(1))
		.join("|")})$`,
	"i",
);
/** A module whose first statement, after comments, is the "use client" directive. */
const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(["'])use client\1/;

/** Whether a module's source starts with the "use client" directive, so its components hydrate. */
export const isClientModule = (source: string): boolean => USE_CLIENT.test(source);
const SOURCE = "island-source:";

const loaderOf = (path: string): JavaScriptLoader => LOADERS[extname(path)] ?? "js";

/**
 * The module the prerender loads in place of a client module: each export goes through `island()` (kit/islands/server.ts),
 * which turns components into islands (telling it whether the module is the kit's own), and the module's own code is loaded
 * under the `island-source:` prefix.
 */
function islandModule(path: string, source: string): string {
	const { exports } = new Bun.Transpiler({ loader: loaderOf(path) }).scan(source);
	const id = JSON.stringify(path);
	const kit = path.startsWith(KIT_DIR + sep);
	return [
		`import * as source from ${JSON.stringify(SOURCE + path)};`,
		`import { island } from ${JSON.stringify(join(ISLANDS, "server.ts"))};`,
		...exports.map((name) =>
			name === "default"
				? `export default island(${id}, "default", source.default, ${kit});`
				: `export const ${name} = island(${id}, ${JSON.stringify(name)}, source.${name}, ${kit});`,
		),
	].join("\n");
}

/** The page being packed: its path and its module, compiled with the page layout (other .mdx files are compiled as fragments). */
export interface CompiledPage {
	path: string;
	js: string;
	/** The frontmatter lang, which components write numbers in while the page prerenders. */
	lang: string;
}

/**
 * What a page build is for: the prerender (client modules swapped for their island wrappers), the browser's client bundle, or
 * the scan of the client code for the kit scripts it needs (kit Question left as an import from QUESTION_IMPORT).
 */
type BuildFor = "prerender" | "browser" | "scan";

/**
 * Resolution and loading for a page build: bare imports to the skill's files, `.mdx` through the MDX compiler, CSS recorded in
 * `css` for the page's `<link>`s instead of bundled, and the swaps `purpose` asks for.
 */
function pagePlugin(
	page: CompiledPage,
	entry: { path: string; code: string },
	css: Set<string>,
	purpose: BuildFor,
): BunPlugin {
	return {
		name: "explainer-page",
		setup(build) {
			build.onResolve(
				{ filter: /^(preact(\/[\w-]+)?|preact-render-to-string|kit)$/ },
				({ path }) => {
					const file = BARE[path];
					return file ? { path: join(SKILL_ROOT, file) } : undefined;
				},
			);
			build.onLoad({ filter: /\.css$/ }, ({ path }) => {
				css.add(path);
				return { contents: "", loader: "js" };
			});
			build.onLoad({ filter: EMBEDDABLE }, ({ path }) => ({
				contents: `export default ${JSON.stringify(dataUri(path))};`,
				loader: "js",
			}));
			build.onLoad({ filter: /\.mdx$/ }, async ({ path }) => ({
				contents: path === page.path ? page.js : (await compileMdx(path, false)).js,
				loader: "js",
			}));
			build.onLoad({ filter: SCRIPT }, ({ path }) => {
				if (path === entry.path) {
					return { contents: entry.code, loader: "js" };
				}
				if (purpose === "scan" && path === QUESTION_MODULE) {
					return { contents: `export { Question } from "${QUESTION_IMPORT}";`, loader: "js" };
				}
				const source = readFileSync(path, "utf8");
				return purpose === "prerender" && isClientModule(source)
					? { contents: islandModule(path, source), loader: "js" }
					: { contents: source, loader: loaderOf(path) };
			});
			build.onResolve({ filter: /^island-source:/ }, ({ path }) => ({
				path: `${path.slice(SOURCE.length)}?source`,
				namespace: "island-source",
			}));
			build.onLoad({ filter: /\?source$/, namespace: "island-source" }, ({ path }) => {
				const file = path.slice(0, -"?source".length);
				return { contents: readFileSync(file, "utf8"), loader: loaderOf(file) };
			});
		},
	};
}

/** Where a build message points, as the author finds it: file:line:column. */
function located(log: BuildMessage | ResolveMessage): string {
	const at = log.position;
	// In an .mdx file the position is in the compiled module, not the source the author sees; the message names the import.
	if (at?.file.endsWith(".mdx")) {
		return `${shownPath(at.file)}: ${log.message}`;
	}
	return at ? `${shownPath(at.file)}:${at.line}:${at.column}: ${log.message}` : log.message;
}

/** Builds one in-memory entry (its path need not exist) with the page plugin and returns the single output's text; a failed build is a PackError. */
async function buildEntry(
	page: CompiledPage,
	entry: { path: string; code: string },
	css: Set<string>,
	options: Pick<BuildConfig, "target" | "format" | "minify" | "external">,
	purpose: BuildFor,
): Promise<string> {
	let built: Awaited<ReturnType<typeof Bun.build>>;
	try {
		built = await Bun.build({
			...options,
			entrypoints: [entry.path],
			// The entry exists only here; `files` lets Bun resolve it, and the plugin's loader returns it.
			files: { [entry.path]: entry.code },
			plugins: [pagePlugin(page, entry, css, purpose)],
			jsx: { runtime: "automatic", importSource: "preact", development: false },
			throw: true,
		});
	} catch (e) {
		if (e instanceof PackError) {
			throw e;
		}
		const logs = e instanceof AggregateError ? e.errors : [e];
		throw new PackError(
			logs
				.map((log) =>
					log instanceof BuildMessage || log instanceof ResolveMessage ? located(log) : String(log),
				)
				.join("\n"),
		);
	}
	const [output, ...assets] = built.outputs;
	if (!output) {
		throw new PackError(`${entry.path}: the build wrote nothing`);
	}
	if (assets.length) {
		throw new PackError(assets.map((asset) => notEmbedded(asset.path)).join("\n"));
	}
	return output.text();
}

/**
 * The message for a file a module imports that EMBEDDABLE does not take: Bun would copy it beside the page under a hashed name
 * (`clip-4hs4mfxp.mp4`), which the single file cannot carry.
 */
const notEmbedded = (asset: string) =>
	`the page imports ${basename(asset).replace(/-[a-z0-9]{8}(?=\.[^.]*$)/, "")}, which pack cannot embed: it embeds imported images (${EMBEDDED.images}) and fonts (${EMBEDDED.fonts})`;

/** What the prerender bundle exports: the page rendered by kit/islands/server.ts's renderPage with `labels` as kitLabels, and the components' language. */
interface Prerender {
	render: (labels: Record<string, string> | undefined) => ReturnType<typeof renderPage>;
	/** kit/components/parts/format.ts's, which this file does not import: its types need the kit's globals. */
	setPageLang: (lang: string) => void;
}

/**
 * Renders the page to static HTML in this process: the page, its imports and Preact are bundled into one module (so they share
 * one Preact), which is imported from a temporary file and run once. Returns the HTML (islands between comment markers) and
 * the islands, and adds the stylesheets the page's modules import to `css`. While it renders, the page's frontmatter `labels` are
 * the global kitLabels, as in the browser, so the components that add text (Question) read the page's. An error the author can
 * fix (kit/islands/server.ts's IslandError) or any error the page throws is a PackError.
 */
export async function prerender(
	page: CompiledPage,
	css: Set<string>,
	labels: Record<string, string> | undefined,
): Promise<{ html: string; islands: Island[] }> {
	const code = `import Content from ${JSON.stringify(page.path)};
export { setPageLang } from ${JSON.stringify(join(KIT_DIR, "components/parts/format.ts"))};
import { renderPage } from ${JSON.stringify(join(ISLANDS, "server.ts"))};
export function render(labels) {
	globalThis.kitLabels = labels;
	try {
		return renderPage(Content);
	} finally {
		delete globalThis.kitLabels;
	}
}`;
	const js = await buildEntry(
		page,
		{ path: join(dirname(page.path), "explainer-prerender.ts"), code },
		css,
		{ target: "bun", format: "esm" },
		"prerender",
	);
	const dir = mkdtempSync(join(tmpdir(), "explainer-prerender-"));
	try {
		const file = join(dir, "page.js");
		writeFileSync(file, js);
		const module: Prerender = await import(file);
		module.setPageLang(page.lang);
		return module.render(labels);
	} catch (e) {
		if (e instanceof PackError) {
			throw e;
		}
		const message = e instanceof Error ? e.message : String(e);
		throw new PackError(
			e instanceof Error && e.name === "IslandError"
				? message
				: `${shownPath(page.path)}: the page threw while rendering: ${message}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The entry that hydrates the islands from `modules`, numbered in the order given, as the islands' JSON names them. */
function islandsEntry(page: CompiledPage, modules: string[]): { path: string; code: string } {
	const code = [
		`import { hydrateIslands } from ${JSON.stringify(join(ISLANDS, "client.ts"))};`,
		...modules.map((path, i) => `import * as m${i} from ${JSON.stringify(path)};`),
		`hydrateIslands([${modules.map((_, i) => `m${i}`).join(", ")}]);`,
	].join("\n");
	return { path: join(dirname(page.path), "explainer-islands.ts"), code };
}

/**
 * The one classic script that hydrates the islands: Preact, the client modules as written (not wrapped) and
 * kit/islands/client.ts, minified.
 */
export function clientBundle(
	page: CompiledPage,
	modules: string[],
	css: Set<string>,
): Promise<string> {
	return buildEntry(
		page,
		islandsEntry(page, modules),
		css,
		{ target: "browser", format: "iife", minify: true },
		"browser",
	);
}

/**
 * The client bundle's code as kit-scripts.ts's scriptsInCode reads it: not minified, so names and props stay as written, and
 * with kit Question left as an import, so its calls rather than its code tell whether it writes a reply question. Tree shaking
 * leaves out the kit components the client modules do not use, so the code holds only markup they can write.
 */
export function clientScan(
	page: CompiledPage,
	modules: string[],
	css: Set<string>,
): Promise<string> {
	return buildEntry(
		page,
		islandsEntry(page, modules),
		css,
		{ target: "browser", format: "esm", external: [QUESTION_IMPORT] },
		"scan",
	);
}
