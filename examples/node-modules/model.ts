/* The installed tree read from data.json (written by fetch.ts): every number on the page is computed here. */
import type { RecordsProps } from "kit";
import data from "./data.json";
import lock from "./package-lock.json";

interface Fetched {
	path: string;
	name: string;
	package: string;
	version: string;
	bytes: number;
	files: number;
	license: string;
	deprecated: string | null;
	requires: string[];
}

const fetched = data.packages as Fetched[];
export const FETCHED = new Date(data.fetched).toLocaleDateString("en-GB", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
/** The listed dependencies, by their folder name. */
export const LISTED = data.listed.map((p) => p.slice("node_modules/".length));

/** A package's id in links: its folders below node_modules joined by ">", so test-exclude>glob is the glob inside test-exclude. */
const idOf = (path: string) => path.split("/node_modules/").join(">").slice("node_modules/".length);
const byPath = new Map(fetched.map((p) => [p.path, p]));
const get = (path: string) => byPath.get(path) as Fetched;

/** What one listed dependency pulls in, itself included. */
function reach(root: string): Set<string> {
	const seen = new Set([root]);
	for (const path of seen) {
		for (const next of get(path).requires) {
			seen.add(next);
		}
	}
	return seen;
}
const reached = data.listed.map(reach);

/** The first requirer on a shortest chain from a listed dependency, read breadth first in the lockfile's order. */
const parent = new Map<string, string | null>(data.listed.map((r) => [r, null]));
for (const path of parent.keys()) {
	for (const next of get(path).requires) {
		if (!parent.has(next)) {
			parent.set(next, path);
		}
	}
}

const requiredBy = new Map<string, string[]>();
for (const p of fetched) {
	for (const r of p.requires) {
		requiredBy.set(r, [...(requiredBy.get(r) ?? []), p.path]);
	}
}

const copies = new Map<string, string[]>();
for (const p of fetched) {
	copies.set(p.package, [...(copies.get(p.package) ?? []), p.path]);
}

const sum = (paths: Iterable<string>) => [...paths].reduce((s, p) => s + get(p).bytes, 0);

export const COUNT = fetched.length;
export const TOTAL = sum(byPath.keys());

/** The heaviest packages that together hold at least half the bytes. */
export const HEAVY = (() => {
	const heavy: string[] = [];
	let held = 0;
	for (const p of [...fetched].sort((a, b) => b.bytes - a.bytes)) {
		if (held >= TOTAL / 2) {
			break;
		}
		heavy.push(p.path);
		held += p.bytes;
	}
	return new Set(heavy);
})();

/** Which listed dependency brings a package: one of them, or "shared" when two or three do. */
type Via = (typeof LISTED)[number] | "shared";
const viaOf = (path: string): Via => {
	const by = LISTED.filter((_, i) => reached[i]?.has(path));
	return by.length === 1 ? (by[0] as string) : "shared";
};

/** Decimal megabytes, the page's one size unit; single packages take three digits so the smallest, 2 kB, still reads. */
export const MB = (bytes: number, digits = 1) => `${(bytes / 1e6).toFixed(digits)} MB`;
const label = (path: string) => `${get(path).name} ${get(path).version}`;

/** Per listed dependency: what it pulls in, and what would stay with only express installed (npm install --omit=dev). */
export const LISTED_TREES = LISTED.map((name, i) => {
	const tree = reached[i] as Set<string>;
	const only = [...tree].filter((p) => viaOf(p) === name);
	return { name, count: tree.size, bytes: sum(tree), onlyCount: only.length, onlyBytes: sum(only) };
});
export const tree = (name: string) =>
	LISTED_TREES.find((t) => t.name === name) as (typeof LISTED_TREES)[number];
export const HEAVY_FROM_JEST = [...HEAVY].filter((p) => viaOf(p) === "jest").length;

/** Names installed more than once, the heaviest first; extra is every copy beyond the largest. */
export const DUPLICATES = [...copies]
	.filter(([, paths]) => paths.length > 1)
	.map(([name, paths]) => {
		const sizes = paths.map((p) => get(p).bytes);
		const total = sizes.reduce((s, b) => s + b, 0);
		return {
			name,
			paths,
			versions: [...new Set(paths.map((p) => get(p).version))].sort((a, b) =>
				b.localeCompare(a, "en", { numeric: true }),
			),
			total,
			extra: total - Math.max(...sizes),
		};
	})
	.sort((a, b) => b.total - a.total);
export const EXTRA_COPIES = DUPLICATES.reduce((s, d) => s + d.paths.length - 1, 0);
export const EXTRA_BYTES = DUPLICATES.reduce((s, d) => s + d.extra, 0);
/** The deprecated package, the chain that brings it, and the copies nested under the package that pins it. */
export const DEPRECATED = (() => {
	const p = fetched.find((q) => q.deprecated) as Fetched;
	const pinner = get(parent.get(p.path) as string);
	const nested = fetched.filter((q) => q.path.startsWith(`${pinner.path}/node_modules/`));
	return {
		id: idOf(p.path),
		label: label(p.path),
		message: p.deprecated as string,
		pinner: { id: idOf(pinner.path), label: label(pinner.path) },
		nested: nested.length,
		nestedBytes: sum(nested.map((q) => q.path)),
	};
})();
/** Builds the lockfile lists for other systems, which npm leaves out on Linux x64. */
export const OTHER_PLATFORMS = Object.keys(lock.packages).length - 1 - COUNT;

/** Licences a typical allow-list names; the page counts what falls outside it. */
const USUAL = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"]);
const usual = (licence: string) => licence.split(/ OR |[()]/).some((l) => USUAL.has(l.trim()));
export const UNUSUAL = (() => {
	const by = new Map<string, string[]>();
	for (const p of fetched) {
		if (!usual(p.license)) {
			by.set(p.license, [...(by.get(p.license) ?? []), p.path]);
		}
	}
	return [...by].map(([licence, paths]) => ({
		licence,
		count: paths.length,
		bytes: sum(paths),
		names: [
			...new Set([...paths].sort((a, b) => get(b).bytes - get(a).bytes).map((p) => get(p).name)),
		],
	}));
})();
export const UNUSUAL_COUNT = UNUSUAL.reduce((s, l) => s + l.count, 0);
export const licence = (name: string) =>
	UNUSUAL.find((l) => l.licence === name) as (typeof UNUSUAL)[number];

const VIA_TEXT = {
	eslint: "The linter: its parser, rule engine and config loading",
	express: "The web server: HTTP parsing, routing and body parsing",
	jest: "The test runner, with Babel to transform test files and Istanbul for coverage",
	shared: "Packages two or three of them need, installed once",
} satisfies Record<Via, string>;

/** One row per installed package, for Records. */
const rows = fetched.map((p) => ({
	id: idOf(p.path),
	name: p.name === p.package ? p.name : `${p.name} (${p.package})`,
	version: p.version,
	mb: p.bytes / 1e6,
	license: p.license,
	via: viaOf(p.path),
	copies: (copies.get(p.package)?.length ?? 1) > 1 ? "more" : "one",
}));

export const records = {
	id: "packages",
	data: rows,
	idField: "id",
	fields: {
		name: { label: "Package", kind: "text" },
		version: { label: "Version", kind: "text" },
		mb: { label: "Size", kind: "number", unit: "MB", digits: 3, sum: true },
		license: {
			label: "Licence",
			kind: "category",
			values: [...new Set(rows.map((r) => r.license))].map((value) => ({ value })),
		},
		via: {
			label: "Brought in by",
			kind: "category",
			values: [...LISTED, "shared"].map((value) => ({
				value,
				label: value,
			})),
		},
		copies: {
			label: "Copies",
			kind: "category",
			values: [
				{ value: "more", label: "on disk more than once" },
				{ value: "one", label: "once" },
			],
		},
	},
	columns: ["name", "version", "license", "mb"],
	groupBy: ["via"],
	groups: Object.entries(VIA_TEXT).map(([v, description]) => ({ path: [v], description })),
	views: ["tree", "table"],
	sort: { field: "mb", desc: true },
	search: ["name"],
	facets: ["license", "copies"],
	link: "package",
} satisfies RecordsProps;

/** One package as its view tells it: why it is here, what needs it, what it needs, and its other copies. */
export const packages = fetched.map((p) => {
	const chain: string[] = [];
	for (let at: string | null | undefined = p.path; at; at = parent.get(at)) {
		chain.unshift(at);
	}
	const link = (path: string) => ({
		id: idOf(path),
		label: label(path),
		size: MB(get(path).bytes, 3),
	});
	return {
		id: idOf(p.path),
		name: p.name,
		package: p.package,
		version: p.version,
		size: MB(p.bytes, 3),
		files: p.files,
		license: p.license,
		deprecated: p.deprecated,
		listed: LISTED.includes(p.name) && parent.get(p.path) === null,
		chain: chain.map(link),
		requiredBy: (requiredBy.get(p.path) ?? []).map(link),
		requires: p.requires.map(link),
		others: (copies.get(p.package) ?? []).filter((c) => c !== p.path).map(link),
	};
});
export type PackageRecord = (typeof packages)[number];

/** One tile: accent when it is one of the heavy few; named when it holds at least `share` of the bytes, room enough to read. */
function tile(p: Fetched, share: number, links: boolean) {
	const heavy = HEAVY.has(p.path);
	const named = p.bytes >= TOTAL * share;
	return {
		name: `${p.name} ${p.version}, ${MB(p.bytes, 3)}`,
		value: p.bytes,
		...(links ? { link: `#package/${idOf(p.path)}`, target: "_self" } : {}),
		...(heavy ? { itemStyle: { color: "var(--accent)" } } : {}),
		label: named
			? {
					show: true,
					formatter: `${p.name}\n${MB(p.bytes)}`,
				}
			: { show: false },
	};
}

/** The opening treemap: area is unpacked bytes, tiles grouped by the listed dependency that brings them. */
export function treemap(links: boolean) {
	const groups = (share: number) =>
		[...LISTED, "shared"].map((via) => {
			const members = fetched.filter((p) => viaOf(p.path) === via);
			const bytes = sum(members.map((p) => p.path));
			return {
				name: `${via}: ${members.length} packages, ${MB(bytes)}`,
				value: bytes,
				children: members.map((p) => tile(p, share, links)),
			};
		});
	// Group borders are gaps; leaf borders and tile colours come from the kit.
	const parent = { borderWidth: 0 };
	return {
		tooltip: { formatter: "{b}" },
		series: [
			{
				type: "treemap",
				data: groups(0.015),
				width: "100%",
				height: "100%",
				top: 0,
				left: 0,
				...(links ? { nodeClick: "link" } : {}),
				label: {
					overflow: "truncate",
					position: "insideTopLeft",
				},
				levels: [
					{ itemStyle: { ...parent, gapWidth: 4 } },
					{
						itemStyle: { ...parent, gapWidth: 1 },
						upperLabel: {
							show: true,
							height: 24,
							color: "var(--ink)",
						},
					},
					{ itemStyle: parent },
				],
			},
		],
		media: [{ query: { maxWidth: 639 }, option: { series: [{ data: groups(0.03) }] } }],
	};
}
