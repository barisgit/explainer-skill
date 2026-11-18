// Reads package-lock.json, keeps what npm installs on Linux x64 (glibc), asks the npm registry for each
// package's unpacked size and licence, and prints the tree as JSON: bun fetch.ts > data.json
import lock from "./package-lock.json";

type Entry = {
	name?: string;
	version?: string;
	license?: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	os?: string[];
	cpu?: string[];
	libc?: string[];
};

const PLATFORM = { os: "linux", cpu: "x64", libc: "glibc" };
const entries = lock.packages as Record<string, Entry>;
const installed = (e: Entry) =>
	(!e.os || e.os.includes(PLATFORM.os)) &&
	(!e.cpu || e.cpu.includes(PLATFORM.cpu)) &&
	(!e.libc || e.libc.includes(PLATFORM.libc));
const paths = Object.keys(entries).filter((p) => p && installed(entries[p] as Entry));
const nameOf = (path: string) =>
	path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** Node's lookup: the nearest node_modules/<name> at or above the requiring package. */
function resolve(from: string, name: string): string | undefined {
	let base = from;
	for (;;) {
		const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
		if (paths.includes(candidate)) {
			return candidate;
		}
		if (!base) {
			return undefined;
		}
		const up = base.lastIndexOf("/node_modules/");
		base = up < 0 ? "" : base.slice(0, up);
	}
}

function requires(path: string): string[] {
	const e = entries[path] as Entry;
	const peers = Object.keys(e.peerDependencies ?? {}).filter(
		(n) => !e.peerDependenciesMeta?.[n]?.optional,
	);
	const names = [
		...Object.keys(e.dependencies ?? {}),
		...Object.keys(e.optionalDependencies ?? {}),
		...peers,
	];
	return [
		...new Set(names.map((n) => resolve(path, n)).filter((p): p is string => p !== undefined)),
	];
}

async function registry(name: string, version: string) {
	const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`);
	if (!res.ok) {
		throw new Error(`${name}@${version}: ${res.status}`);
	}
	const doc = (await res.json()) as {
		license?: string;
		dist: { tarball: string; unpackedSize?: number; fileCount?: number };
		deprecated?: string;
	};
	// Packages published before npm recorded unpackedSize: sum the file sizes in their tarball.
	if (doc.dist.unpackedSize === undefined) {
		Object.assign(doc.dist, await tarballSize(doc.dist.tarball));
	}
	return doc;
}

async function tarballSize(url: string) {
	const res = await fetch(url);
	if (!res.body) {
		throw new Error(`${url}: ${res.status}`);
	}
	const tar = new Uint8Array(
		await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
	);
	let unpackedSize = 0;
	let fileCount = 0;
	for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
		const size = Number.parseInt(
			new TextDecoder().decode(tar.subarray(at + 124, at + 136)).trim() || "0",
			8,
		);
		const type = String.fromCharCode(tar[at + 156] ?? 0);
		if (type === "0" || type === "\0") {
			unpackedSize += size;
			fileCount += 1;
		}
		at += 512 + Math.ceil(size / 512) * 512;
	}
	return { unpackedSize, fileCount };
}

const out: unknown[] = [];
for (let i = 0; i < paths.length; i += 16) {
	const batch = paths.slice(i, i + 16);
	out.push(
		...(await Promise.all(
			batch.map(async (path) => {
				const e = entries[path] as Entry;
				const name = nameOf(path);
				const version = e.version ?? "";
				// An alias (string-width-cjs) is installed under its own folder name but is another package's version.
				const doc = await registry(e.name ?? name, version);
				return {
					path,
					name,
					package: e.name ?? name,
					version,
					bytes: doc.dist.unpackedSize ?? null,
					files: doc.dist.fileCount ?? null,
					license: doc.license ?? e.license ?? null,
					deprecated: doc.deprecated ?? null,
					requires: requires(path),
				};
			}),
		)),
	);
}

const root = entries[""] as Entry;
console.log(
	JSON.stringify(
		{
			fetched: new Date().toISOString().slice(0, 10),
			platform: `${PLATFORM.os}-${PLATFORM.cpu}-${PLATFORM.libc}`,
			listed: Object.keys(root.dependencies ?? {}).map((n) => `node_modules/${n}`),
			packages: out,
		},
		null,
		"\t",
	),
);
