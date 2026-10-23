import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import type { BuildConfig, BunPlugin, JavaScriptLoader } from "bun";
import type { Island, renderPage } from "../../kit/islands/server.ts";
import { PackError } from "../pack-error.ts";
import { KIT_DIR, SKILL_ROOT } from "../paths.ts";
import { compileMdx } from "./compile.ts";

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
/** A module whose first statement, after comments, is the "use client" directive. */
const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(["'])use client\1/;
const SOURCE = "island-source:";

/** What the builds of one page saw besides their output: the stylesheets its modules import and every script module loaded. */
export interface Seen {
	css: Set<string>;
	modules: Set<string>;
}

const loaderOf = (path: string): JavaScriptLoader => LOADERS[extname(path)] ?? "js";

/**
 * The module the prerender loads in place of a client module: each export goes through `island()` (kit/islands/server.ts),
 * which turns components into islands, and the module's own code is loaded under the `island-source:` prefix.
 */
function islandModule(path: string, source: string): string {
	const { exports } = new Bun.Transpiler({ loader: loaderOf(path) }).scan(source);
	const id = JSON.stringify(path);
	return [
		`import * as source from ${JSON.stringify(SOURCE + path)};`,
		`import { island } from ${JSON.stringify(join(ISLANDS, "server.ts"))};`,
		...exports.map((name) =>
			name === "default"
				? `export default island(${id}, "default", source.default);`
				: `export const ${name} = island(${id}, ${JSON.stringify(name)}, source.${name});`,
		),
	].join("\n");
}

/** The page being packed: its path and its module, compiled with the page layout (other .mdx files are compiled as fragments). */
export interface CompiledPage {
	path: string;
	js: string;
}

/**
 * Resolution and loading for a page build: bare imports to the skill's files, `.mdx` through the MDX compiler, CSS recorded for
 * the page's `<link>`s instead of bundled, and, for the prerender, client modules swapped for their island wrappers.
 */
function pagePlugin(
	page: CompiledPage,
	entry: { path: string; code: string },
	seen: Seen,
	prerender: boolean,
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
				seen.css.add(path);
				return { contents: "", loader: "js" };
			});
			build.onLoad({ filter: /\.mdx$/ }, async ({ path }) => ({
				contents: path === page.path ? page.js : (await compileMdx(path, false)).js,
				loader: "js",
			}));
			build.onLoad({ filter: SCRIPT }, ({ path }) => {
				if (path === entry.path) {
					return { contents: entry.code, loader: "js" };
				}
				seen.modules.add(path);
				const source = readFileSync(path, "utf8");
				return prerender && USE_CLIENT.test(source)
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
		return `${relative(process.cwd(), at.file) || at.file}: ${log.message}`;
	}
	return at
		? `${relative(process.cwd(), at.file) || at.file}:${at.line}:${at.column}: ${log.message}`
		: log.message;
}

/** Builds one in-memory entry (its path need not exist) with the page plugin and returns the single output's text; a failed build is a PackError. */
async function buildEntry(
	page: CompiledPage,
	entry: { path: string; code: string },
	seen: Seen,
	options: Pick<BuildConfig, "target" | "format" | "minify">,
	prerender: boolean,
): Promise<string> {
	let built: Awaited<ReturnType<typeof Bun.build>>;
	try {
		built = await Bun.build({
			...options,
			entrypoints: [entry.path],
			// The entry exists only here; `files` lets Bun resolve it, and the plugin's loader returns it.
			files: { [entry.path]: entry.code },
			plugins: [pagePlugin(page, entry, seen, prerender)],
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
	const [output] = built.outputs;
	if (!output) {
		throw new PackError(`${entry.path}: the build wrote nothing`);
	}
	return output.text();
}

/** What the prerender bundle exports: kit/islands/server.ts's renderPage and the page's content component. */
interface Prerender {
	renderPage: typeof renderPage;
	Content: Parameters<typeof renderPage>[0];
}

/**
 * Renders the page to static HTML in this process: the page, its imports and Preact are bundled into one module (so they share
 * one Preact), which is imported from a temporary file and run once. Returns the HTML (islands between comment markers) and
 * the islands. An error the author can fix (kit/islands/server.ts's IslandError) or any error the page throws is a PackError.
 */
export async function prerender(
	page: CompiledPage,
	seen: Seen,
): Promise<{ html: string; islands: Island[] }> {
	const code = `import Content from ${JSON.stringify(page.path)};
export { Content };
export { renderPage } from ${JSON.stringify(join(ISLANDS, "server.ts"))};`;
	const js = await buildEntry(
		page,
		{ path: join(dirname(page.path), "explainer-prerender.ts"), code },
		seen,
		{ target: "bun", format: "esm" },
		true,
	);
	const dir = mkdtempSync(join(tmpdir(), "explainer-prerender-"));
	try {
		const file = join(dir, "page.js");
		writeFileSync(file, js);
		const module: Prerender = await import(file);
		return module.renderPage(module.Content);
	} catch (e) {
		if (e instanceof PackError) {
			throw e;
		}
		const message = e instanceof Error ? e.message : String(e);
		throw new PackError(
			e instanceof Error && e.name === "IslandError"
				? message
				: `${relative(process.cwd(), page.path)}: the page threw while rendering: ${message}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * The one classic script that hydrates the islands: Preact, the client modules as written (not wrapped) and
 * kit/islands/client.ts, minified. `modules` are numbered in the order given, as the islands' JSON names them.
 */
export function clientBundle(page: CompiledPage, modules: string[], seen: Seen): Promise<string> {
	const code = [
		`import { hydrateIslands } from ${JSON.stringify(join(ISLANDS, "client.ts"))};`,
		...modules.map((path, i) => `import * as m${i} from ${JSON.stringify(path)};`),
		`hydrateIslands([${modules.map((_, i) => `m${i}`).join(", ")}]);`,
	].join("\n");
	return buildEntry(
		page,
		{ path: join(dirname(page.path), "explainer-islands.ts"), code },
		seen,
		{ target: "browser", format: "iife", minify: true },
		false,
	);
}
