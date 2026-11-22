import type {
	ImportDeclaration,
	ImportDefaultSpecifier,
	ImportNamespaceSpecifier,
	ImportSpecifier,
	Program,
} from "estree";
import type { Root, RootContent } from "mdast";
import type { MdxjsEsm } from "mdast-util-mdxjs-esm";
import { PackError } from "../pack-error.ts";

/** The import and export statements an MDX file writes at its root, each with the program its line parses to. */
export const esmOf = (tree: Root): MdxjsEsm[] =>
	tree.children.filter((node): node is MdxjsEsm => node.type === "mdxjsEsm");

export const programOf = (node: MdxjsEsm): Program | undefined => node.data?.estree ?? undefined;

type Specifier = ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier;

/** One name an import binds: the specifier and the declaration it is in. */
export interface Imported {
	local: string;
	specifier: Specifier;
	declaration: ImportDeclaration;
}

/** Every name the file's imports bind. */
export function importsOf(tree: Root): Imported[] {
	return esmOf(tree).flatMap((node) =>
		(programOf(node)?.body ?? []).flatMap((statement) =>
			statement.type === "ImportDeclaration"
				? statement.specifiers.map((specifier) => ({
						local: specifier.local.name,
						specifier,
						declaration: statement,
					}))
				: [],
		),
	);
}

const isObject = (value: unknown): value is object => value !== null && typeof value === "object";

/** Where a node starts: an mdast node's position, an estree node's loc. */
interface Start {
	start?: { line?: number };
}

/** A node of an mdast or estree tree as the walks here read it: its type, and the name, position and loc some have. */
export interface LooseNode {
	type: string;
	name?: unknown;
	position?: Start;
	loc?: Start | null;
}

const isNode = (value: object): value is LooseNode =>
	"type" in value && typeof value.type === "string";

/** Every node in `value` (mdast and estree nodes alike, as LooseNode), depth first. */
export function* nodesIn(value: unknown): Generator<LooseNode> {
	if (Array.isArray(value)) {
		for (const item of value) {
			yield* nodesIn(item);
		}
		return;
	}
	if (!isObject(value)) {
		return;
	}
	if (isNode(value)) {
		yield value;
	}
	for (const [key, child] of Object.entries(value)) {
		if (key !== "position" && key !== "loc") {
			yield* nodesIn(child);
		}
	}
}

/** A JSX tag's name as written, from an mdast JSX element or an estree opening element: undefined for a fragment or a member. */
function tagName(node: LooseNode): string | undefined {
	if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
		return typeof node.name === "string" ? node.name : undefined;
	}
	const name = node.type === "JSXOpeningElement" && isObject(node.name) ? node.name : undefined;
	return name && isNode(name) && name.type === "JSXIdentifier" && typeof name.name === "string"
		? name.name
		: undefined;
}

/**
 * Fails on a JSX tag that starts with a small letter and names an import (`<s10_Mean />` for `import { s10_Mean }`): MDX writes
 * such a tag as an HTML element, so the component never draws and nothing else says why.
 */
export function lowercaseImports(tree: Root, file: string) {
	const imported = new Set(importsOf(tree).map((i) => i.local));
	for (const node of nodesIn(tree.children.filter((n: RootContent) => n.type !== "mdxjsEsm"))) {
		const name = tagName(node);
		if (name && /^[a-z]/.test(name) && imported.has(name)) {
			const line = (node.position ?? node.loc)?.start?.line;
			const capital = name[0]?.toUpperCase() + name.slice(1);
			throw new PackError(
				`${file}${line ? `:${line}` : ""}: <${name}> starts with a small letter, so MDX writes it as an HTML element and the imported ${name} never draws: import it under a capitalised name (import { ${name} as ${capital} }) and write <${capital} />`,
			);
		}
	}
}
