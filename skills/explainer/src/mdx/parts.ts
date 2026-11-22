import { dirname, relative, resolve, sep } from "node:path";
import type { ImportDeclaration, ModuleDeclaration, Pattern, Statement } from "estree";
import type { Nodes, Root, RootContent } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import type { MdxjsEsm } from "mdast-util-mdxjs-esm";
import { PackError } from "../pack-error.ts";
import { shownPath } from "../paths.ts";
import { esmOf, importsOf, nodesIn, programOf } from "./esm.ts";

/*
 * A page in parts: `import Intro from "./parts/intro.mdx"` and `<Intro />` on a line of its own, at the page's root or in a View,
 * puts the part's Markdown there before the page is laid out (structure.ts), so its # and ##s make the masthead, sections and
 * rail as if the page were one file. The part's imports and exports join the page's, their paths rewritten to the page's
 * directory; one the page already has is kept once, and a name bound to two different things fails with both files, as do
 * Markdown reference definitions that differ. A part that cannot join the page's module (props or children, a layout, or
 * files it loads relative to itself with import() or import.meta) stays a component of its own, as any imported .mdx is;
 * pack warns when its headings then make no sections.
 */

/** Reads one part as the page's own MDX would be read, its positions moved into the page's joined text (origins.ts). */
export type LoadPart = (path: string) => Promise<Root>;

type EsmStatement = Statement | ModuleDeclaration;

/** What a bound name is, compared across files, and the file that bound it first. */
interface Binding {
	key: string;
	file: string;
}

/** One splice of a page: how parts are read, and the reference definitions seen so far, by label. */
interface Splice {
	load: LoadPart;
	definitions: Map<string, Binding>;
}

const isRelative = (source: string) => source.startsWith("./") || source.startsWith("../");

/** A relative source as written from `from`'s directory, written from `to`'s; any other source as it is. */
function moved(source: string, from: string, to: string) {
	if (!isRelative(source)) {
		return source;
	}
	const path = relative(dirname(to), resolve(dirname(from), source))
		.split(sep)
		.join("/");
	return path.startsWith("../") ? path : `./${path}`;
}

/** What an import's source names, the same from any file: a relative one resolved from the file's directory. */
const sourceKey = (source: string, file: string) =>
	isRelative(source) ? resolve(dirname(file), source) : source;

/** The names a binding pattern declares (`const { a, b: [c] } = ...`). */
function patternNames(pattern: Pattern): string[] {
	switch (pattern.type) {
		case "Identifier":
			return [pattern.name];
		case "ObjectPattern":
			return pattern.properties.flatMap((p) =>
				patternNames(p.type === "RestElement" ? p.argument : p.value),
			);
		case "ArrayPattern":
			return pattern.elements.flatMap((e) => (e ? patternNames(e) : []));
		case "RestElement":
			return patternNames(pattern.argument);
		case "AssignmentPattern":
			return patternNames(pattern.left);
		default:
			return [];
	}
}

/** What an import specifier takes from its module: a name, `default` (written either way) or `*`. */
const importedName = (s: ImportDeclaration["specifiers"][number]) =>
	s.type === "ImportDefaultSpecifier"
		? "default"
		: s.type === "ImportNamespaceSpecifier"
			? "*"
			: s.imported.type === "Identifier"
				? s.imported.name
				: String(s.imported.value);

/** The file a statement was first written in: a nested part's statements keep it as they are joined up through each parent. */
const writtenIn = new WeakMap<object, string>();

/** The names an export statement binds locally, and those it exports (`export:<name>`), each keyed by the statement's file. */
function exportBindings(statement: EsmStatement, file: string): [string, string][] {
	if (statement.type !== "ExportNamedDeclaration") {
		return [];
	}
	const key = `decl:${writtenIn.get(statement) ?? file}`;
	const { declaration } = statement;
	const declared =
		declaration?.type === "VariableDeclaration"
			? declaration.declarations.flatMap((d) => patternNames(d.id))
			: declaration?.id
				? [declaration.id.name]
				: [];
	const exported = statement.specifiers.map((s) =>
		s.exported.type === "Identifier" ? s.exported.name : String(s.exported.value),
	);
	return [
		...declared.map((name): [string, string] => [name, key]),
		...exported.map((name): [string, string] => [`export:${name}`, key]),
	];
}

/**
 * The names one top-level statement binds, each with what it is: `import:<source>#<name>` for an import, `side:<source>` as
 * both name and key for an import with no names (a stylesheet), and the file of an export's declaration (exportBindings).
 */
function bindingsOf(statement: EsmStatement, file: string): [string, string][] {
	if (statement.type !== "ImportDeclaration") {
		return exportBindings(statement, file);
	}
	const source = sourceKey(String(statement.source.value), file);
	return statement.specifiers.length
		? statement.specifiers.map((s) => [s.local.name, `import:${source}#${importedName(s)}`])
		: [[`side:${source}`, `side:${source}`]];
}

/** The names the tree's own imports and exports bind. */
function ownBindings(tree: Root, file: string): Map<string, Binding> {
	const bound = new Map<string, Binding>();
	for (const node of esmOf(tree)) {
		for (const statement of programOf(node)?.body ?? []) {
			for (const [name, key] of bindingsOf(statement, file)) {
				bound.set(name, { key, file });
			}
		}
	}
	return bound;
}

/** Binds `name` to `key` for `file`; returns whether it is new. A name already bound to something else fails, naming both files. */
function bindNew(
	bound: Map<string, Binding>,
	name: string,
	key: string,
	file: string,
	what = name,
) {
	const had = bound.get(name);
	if (had && had.key !== key) {
		throw new PackError(
			`${shownPath(file)}: ${what} is bound in ${shownPath(had.file)} too, to something else; a part's names join the page's, so rename one of them`,
		);
	}
	bound.set(name, { key, file });
	return !had;
}

/**
 * The part's statements that the page does not have yet, their sources rewritten from the part's directory to the page's: an
 * import of names the page already binds to the same thing, or the same export joined through another part, is dropped.
 */
function joinEsm(node: MdxjsEsm, part: string, page: string, bound: Map<string, Binding>) {
	const program = programOf(node);
	if (!program) {
		return [];
	}
	program.body = program.body.flatMap((statement) => {
		if (!writtenIn.has(statement)) {
			writtenIn.set(statement, part);
		}
		const bindings = bindingsOf(statement, part);
		const fresh = new Set(
			bindings.filter(([name, key]) => bindNew(bound, name, key, part)).map(([name]) => name),
		);
		if (bindings.length && !fresh.size) {
			return [];
		}
		if (statement.type === "ImportDeclaration") {
			statement.specifiers = statement.specifiers.filter((s) => fresh.has(s.local.name));
		}
		if ("source" in statement && typeof statement.source?.value === "string") {
			const source = moved(statement.source.value, part, page);
			statement.source = { type: "Literal", value: source, raw: JSON.stringify(source) };
		}
		return [statement];
	});
	return program.body.length ? [node] : [];
}

/** Whether the part is the default export: `export default`, or `export { x as default }`, which MDX takes as the layout. */
const isLayout = (statement: EsmStatement) =>
	statement.type === "ExportDefaultDeclaration" ||
	(statement.type === "ExportNamedDeclaration" &&
		statement.specifiers.some(
			(s) => (s.exported.type === "Identifier" ? s.exported.name : s.exported.value) === "default",
		));

/** Why a part element must stay a component, or undefined when it can be spliced; with what the author can do instead. */
function keptBecause(node: MdxJsxFlowElement, tree: Root): string | undefined {
	if (node.attributes.length || node.children.length) {
		return `has props or children; write <${node.name} /> alone to lay it out as part of the page`;
	}
	if (esmOf(tree).some((esm) => programOf(esm)?.body.some(isLayout))) {
		return "has a layout (export default); wrap its content in a component it imports instead";
	}
	const loadsRelative = [...nodesIn(tree)].some(
		(n) => n.type === "ImportExpression" || n.type === "MetaProperty",
	);
	return loadsRelative
		? "loads files relative to itself (import() or import.meta); import them at its top instead"
		: undefined;
}

const isHeading = (node: RootContent) =>
	(node.type === "heading" && node.depth <= 2) ||
	(node.type === "mdxJsxFlowElement" && (node.name === "h1" || node.name === "h2"));

/** The flow containers structure.ts lays out: the root and every View. */
function* containers(tree: Root): Generator<{ children: Nodes[] }> {
	yield tree as { children: Nodes[] };
	for (const node of nodesIn(tree.children)) {
		if (node.type === "mdxJsxFlowElement" && node.name === "View") {
			yield node as unknown as { children: Nodes[] };
		}
	}
}

/**
 * Adds the file's own Markdown reference definitions (`[doc]: url`, footnotes) to those of the page so far: the spliced page is
 * one Markdown document, where the first definition of a label wins, so the same label defined otherwise fails.
 */
function addDefinitions(tree: Root, file: string, splice: Splice) {
	for (const node of nodesIn(tree.children)) {
		if (node.type === "definition" || node.type === "footnoteDefinition") {
			const { identifier, url } = node as { identifier?: string; url?: string };
			const label = `${node.type}:${identifier}`;
			const key = node.type === "definition" ? `${url}` : `${file}:${identifier}`;
			bindNew(
				splice.definitions,
				label,
				key,
				file,
				`[${node.type === "definition" ? "" : "^"}${identifier}]`,
			);
		}
	}
}

/** What splicing a tree's parts gathers: their statements for the tree's root, warnings, and the part names spliced. */
interface Gathered {
	esm: { node: MdxjsEsm; part: string }[];
	warnings: string[];
	files: Set<string>;
	locals: Set<string>;
}

/** Reads a part, naming the file that imports it when it cannot be read. */
async function loadFrom(splice: Splice, part: string, node: MdxJsxFlowElement, file: string) {
	try {
		return await splice.load(part);
	} catch (e) {
		if (e instanceof PackError) {
			throw e;
		}
		throw new PackError(
			`${shownPath(file)}: <${node.name}> imports ${shownPath(part)}, which cannot be read: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/** The nodes one part element becomes: the part's own content, spliced, or the element kept (with a warning when it has headings). */
async function partNodes(
	node: MdxJsxFlowElement,
	part: string,
	file: string,
	chain: string[],
	splice: Splice,
	gathered: Gathered,
): Promise<Nodes[]> {
	if (chain.includes(part)) {
		throw new PackError(
			`${shownPath(file)}: <${node.name}> imports ${shownPath(part)}, which imports it back`,
		);
	}
	const tree = await loadFrom(splice, part, node, file);
	const kept = keptBecause(node, tree);
	if (kept) {
		if (tree.children.some(isHeading)) {
			gathered.warnings.push(
				`${shownPath(file)}: <${node.name}> stays a component, so its # and ## headings make no masthead, sections or contents entries: it ${kept}`,
			);
		}
		return [node];
	}
	addDefinitions(tree, part, splice);
	gathered.warnings.push(...(await spliceInto(tree, part, [...chain, part], splice)));
	gathered.locals.add(node.name ?? "");
	if (!gathered.files.has(part)) {
		gathered.files.add(part);
		gathered.esm.push(...esmOf(tree).map((esm) => ({ node: esm, part })));
	}
	return tree.children.filter((n) => n.type !== "mdxjsEsm" && n.type !== "yaml");
}

/** Whether the tree still names `local` outside its imports: a part element left as it is, or an expression. */
const stillUsed = (tree: Root, local: string) =>
	[...nodesIn(tree.children, (n) => n.type === "ImportDeclaration")].some(
		(n) => n.name === local && /^(mdxJsx|Identifier$|JSXIdentifier$)/.test(n.type),
	);

/** The part imports of the tree: each default import of a relative .mdx file (`import P` or `import { default as P }`). */
const partImports = (tree: Root, file: string) =>
	new Map(
		importsOf(tree).flatMap(({ local, specifier, declaration }) => {
			const source = String(declaration.source.value);
			return importedName(specifier) === "default" && isRelative(source) && source.endsWith(".mdx")
				? [[local, resolve(dirname(file), source)] as const]
				: [];
		}),
	);

/**
 * Splices the bare part elements of `tree` (the file at `file`, reached through `chain`) with their parts' content, at its
 * root and in its Views, and joins their imports and exports into its own. Returns the warnings about parts kept as components.
 */
async function spliceInto(tree: Root, file: string, chain: string[], splice: Splice) {
	const parts = partImports(tree, file);
	const gathered: Gathered = { esm: [], warnings: [], files: new Set(), locals: new Set() };
	if (!parts.size) {
		return gathered.warnings;
	}
	for (const container of [...containers(tree)]) {
		const children: Nodes[] = [];
		for (const node of container.children) {
			const part = node.type === "mdxJsxFlowElement" ? parts.get(node.name ?? "") : undefined;
			children.push(
				...(part && node.type === "mdxJsxFlowElement"
					? await partNodes(node, part, file, chain, splice, gathered)
					: [node]),
			);
		}
		container.children = children;
	}
	dropSpliced(
		tree,
		[...gathered.locals].filter((local) => !stillUsed(tree, local)),
	);
	const bound = ownBindings(tree, file);
	tree.children.unshift(
		...gathered.esm.flatMap(({ node, part }) => joinEsm(node, part, file, bound)),
	);
	return gathered.warnings;
}

/** Removes the imports of parts every use of which was spliced: the bundle would run them as modules of their own for nothing. */
function dropSpliced(tree: Root, unused: string[]) {
	for (const node of esmOf(tree)) {
		const program = programOf(node);
		if (program) {
			program.body = program.body.filter((statement) => {
				if (statement.type !== "ImportDeclaration" || !statement.specifiers.length) {
					return true;
				}
				statement.specifiers = statement.specifiers.filter((s) => !unused.includes(s.local.name));
				return statement.specifiers.length > 0;
			});
		}
	}
	tree.children = tree.children.filter(
		(node) => node.type !== "mdxjsEsm" || (programOf(node)?.body.length ?? 1) > 0,
	);
}

/**
 * Splices the page's parts into its tree (see the top of this file), before structure.ts lays it out. Returns pack's warnings
 * about parts that stay components although they hold headings.
 */
export function spliceParts(tree: Root, file: string, load: LoadPart) {
	const splice: Splice = { load, definitions: new Map() };
	addDefinitions(tree, file, splice);
	return spliceInto(tree, file, [file], splice);
}
