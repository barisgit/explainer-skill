import { dirname, relative, resolve, sep } from "node:path";
import type { ImportDeclaration, Pattern } from "estree";
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
 * directory; an import the page already has is kept once, and a name bound to two different things fails with both files.
 * A part given props or children, or with a layout (export default), stays a component of its own, as any imported .mdx is;
 * pack warns when its headings would then make no sections.
 */

/** Reads one part as the page's own MDX would be read, its positions moved into the page's joined text (origins.ts). */
export type LoadPart = (path: string) => Promise<Root>;

/** What a bound name is, compared across files: an import's resolved source and imported name, or the file declaring it. */
interface Binding {
	key: string;
	file: string;
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

type EsmStatement = NonNullable<ReturnType<typeof programOf>>["body"][number];

/** What an import specifier takes from its module: a name, the default or the namespace. */
const importedName = (s: ImportDeclaration["specifiers"][number]) =>
	s.type !== "ImportSpecifier"
		? s.type
		: s.imported.type === "Identifier"
			? s.imported.name
			: String(s.imported.value);

/**
 * The names one top-level statement binds, each with what it is: `import:<source>#<name>` for an import, `side:<source>` as
 * both name and key for an import with no names (a stylesheet), and `decl:<file>` for an export's declaration.
 */
function bindingsOf(statement: EsmStatement, file: string): [string, string][] {
	if (statement.type === "ImportDeclaration") {
		const source = sourceKey(String(statement.source.value), file);
		return statement.specifiers.length
			? statement.specifiers.map((s) => [s.local.name, `import:${source}#${importedName(s)}`])
			: [[`side:${source}`, `side:${source}`]];
	}
	const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : null;
	const names =
		declaration?.type === "VariableDeclaration"
			? declaration.declarations.flatMap((d) => patternNames(d.id))
			: declaration?.id
				? [declaration.id.name]
				: [];
	return names.map((name) => [name, `decl:${file}`]);
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

/** Binds the statement's names; returns those the page did not have. A name bound to something else fails, naming both files. */
function bindNew(statement: EsmStatement, part: string, bound: Map<string, Binding>) {
	const fresh = new Set<string>();
	for (const [name, key] of bindingsOf(statement, part)) {
		const had = bound.get(name);
		if (had && had.key !== key) {
			throw new PackError(
				`${shownPath(part)}: ${name} is bound in ${shownPath(had.file)} too, to something else; a part's names join the page's, so rename one of them (import { ${name} as other })`,
			);
		}
		if (!had) {
			bound.set(name, { key, file: part });
			fresh.add(name);
		}
	}
	return fresh;
}

/**
 * The part's statements that the page does not have yet, their sources rewritten from the part's directory to the page's: an
 * import of names the page already binds to the same thing is dropped.
 */
function joinEsm(node: MdxjsEsm, part: string, page: string, bound: Map<string, Binding>) {
	const program = programOf(node);
	if (!program) {
		return [];
	}
	program.body = program.body.flatMap((statement) => {
		const fresh = bindNew(statement, part, bound);
		if (statement.type === "ImportDeclaration") {
			if (!fresh.size) {
				return [];
			}
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

/** A part written as one: an element naming a part import, with no props or children. */
const isBare = (node: MdxJsxFlowElement) => !node.attributes.length && !node.children.length;

const hasLayout = (tree: Root) =>
	esmOf(tree).some((node) =>
		programOf(node)?.body.some((s) => s.type === "ExportDefaultDeclaration"),
	);

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

/** What splicing a tree's parts gathers: their statements for the tree's root, and warnings. */
interface Gathered {
	esm: { node: MdxjsEsm; part: string }[];
	warnings: string[];
	spliced: Set<string>;
}

/** The nodes one part element becomes: the part's own content, spliced, or the element kept (with a warning when it has headings). */
async function partNodes(
	node: MdxJsxFlowElement,
	part: string,
	file: string,
	chain: string[],
	load: LoadPart,
	gathered: Gathered,
): Promise<Nodes[]> {
	if (chain.includes(part)) {
		throw new PackError(
			`${shownPath(file)}: <${node.name}> imports ${shownPath(part)}, which imports it back`,
		);
	}
	const tree = await load(part);
	if (!isBare(node) || hasLayout(tree)) {
		if (tree.children.some(isHeading)) {
			gathered.warnings.push(
				`${shownPath(file)}: <${node.name}> ${hasLayout(tree) ? "has a layout (export default)" : "has props or children"}, so it stays a component and its # and ## headings make no masthead, sections or contents entries; write <${node.name} /> alone to lay it out as part of the page`,
			);
		}
		return [node];
	}
	gathered.warnings.push(...(await spliceInto(tree, part, [...chain, part], load)));
	if (!gathered.spliced.has(part)) {
		gathered.spliced.add(part);
		gathered.esm.push(...esmOf(tree).map((esm) => ({ node: esm, part })));
	}
	return tree.children.filter((n) => n.type !== "mdxjsEsm" && n.type !== "yaml");
}

/** Whether the tree still names `local` anywhere but in its imports: a part element left as it is, or an expression. */
const stillUsed = (tree: Root, local: string) => {
	for (const node of nodesIn(tree.children)) {
		if (node.type === "ImportDeclaration") {
			continue;
		}
		if (node.name === local && /^(mdxJsx|Identifier$|JSXIdentifier$)/.test(node.type)) {
			return true;
		}
	}
	return false;
};

/**
 * Splices the bare part elements of `tree` (the file at `file`, reached through `chain`) with their parts' content, at its
 * root and in its Views, and joins their imports and exports into its own. Returns the warnings about parts kept as components.
 */
async function spliceInto(tree: Root, file: string, chain: string[], load: LoadPart) {
	const parts = new Map(
		importsOf(tree).flatMap(({ local, specifier, declaration }) => {
			const source = String(declaration.source.value);
			return specifier.type === "ImportDefaultSpecifier" &&
				isRelative(source) &&
				source.endsWith(".mdx")
				? [[local, resolve(dirname(file), source)] as const]
				: [];
		}),
	);
	const gathered: Gathered = { esm: [], warnings: [], spliced: new Set() };
	if (!parts.size) {
		return gathered.warnings;
	}
	for (const container of [...containers(tree)]) {
		const children: Nodes[] = [];
		for (const node of container.children) {
			const part = node.type === "mdxJsxFlowElement" ? parts.get(node.name ?? "") : undefined;
			children.push(
				...(part && node.type === "mdxJsxFlowElement"
					? await partNodes(node, part, file, chain, load, gathered)
					: [node]),
			);
		}
		container.children = children;
	}
	dropSpliced(tree, [...parts.keys()]);
	const bound = ownBindings(tree, file);
	tree.children.unshift(
		...gathered.esm.flatMap(({ node, part }) => joinEsm(node, part, file, bound)),
	);
	return gathered.warnings;
}

/** Removes the imports of parts the tree no longer names, since every use was spliced: the bundle would load them for nothing. */
function dropSpliced(tree: Root, locals: string[]) {
	const unused = new Set(locals.filter((local) => !stillUsed(tree, local)));
	for (const node of esmOf(tree)) {
		const program = programOf(node);
		if (program) {
			program.body = program.body.filter((statement) => {
				if (statement.type !== "ImportDeclaration" || !statement.specifiers.length) {
					return true;
				}
				statement.specifiers = statement.specifiers.filter((s) => !unused.has(s.local.name));
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
export const spliceParts = (tree: Root, file: string, load: LoadPart) =>
	spliceInto(tree, file, [file], load);
