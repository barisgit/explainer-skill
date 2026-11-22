import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

/** Orthogonal segments can meet a box's edge at a port, but must not enter its interior. */
function entersBox(a: Point, b: Point, box: Box): boolean {
	const { x, y, width, height } = box;
	return (
		(a.x === b.x &&
			a.x > x &&
			a.x < x + width &&
			Math.max(a.y, b.y) > y &&
			Math.min(a.y, b.y) < y + height) ||
		(a.y === b.y &&
			a.y > y &&
			a.y < y + height &&
			Math.max(a.x, b.x) > x &&
			Math.min(a.x, b.x) < x + width)
	);
}

function crossings(svg: string): string[] {
	const nodes = [
		...svg.matchAll(
			/<g class="node" data-id="([^"]+)"[^>]*>\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g,
		),
	].map(([, id, x, y, width, height]) => ({
		id,
		x: Number(x),
		y: Number(y),
		width: Number(width),
		height: Number(height),
	}));
	const edges = [
		...svg.matchAll(
			/<polyline class="edge"[^>]* data-from="([^"]+)" data-to="([^"]+)"[^>]* points="([^"]+)"/g,
		),
	];
	expect(nodes).toHaveLength(6);
	expect(edges).toHaveLength(6);
	return edges.flatMap(([, from, to, coordinates = ""]) => {
		const points = coordinates.split(" ").map((xy) => {
			const [x, y] = xy.split(",");
			return { x: Number(x), y: Number(y) };
		});
		return nodes
			.filter(
				(box) =>
					box.id !== from &&
					box.id !== to &&
					points.slice(1).some((b, i) => {
						const a = points[i];
						return a && entersBox(a, b, box);
					}),
			)
			.map((box) => `${from} → ${to} crosses ${box.id}`);
	});
}

const fanOut = `  client[Client] --> app[App server]
  app --> queue[Job queue]
  queue --> worker[Worker]
  worker --> db[Database]
  app --> db
  app --> cache[Cache]`;

// The label rules out fan-out at the database, leaving only fan-in at the app.
const fanIn = `  db[Database] -->|jobs| worker[Worker]
  worker --> queue[Job queue]
  queue --> app[App server]
  app --> client[Client]
  db --> app
  cache[Cache] --> app`;

test.each([
	{ direction: "LR", bundle: "fan-out", links: fanOut },
	{ direction: "TD", bundle: "fan-out", links: fanOut },
	{ direction: "LR", bundle: "fan-in", links: fanIn },
	{ direction: "TD", bundle: "fan-in", links: fanIn },
])(
	"$direction $bundle routes skip edges clear of every node",
	async ({ direction, bundle, links }) => {
		const output = await packedMdx(
			dir,
			`architecture-${direction}-${bundle}`,
			`# Application architecture

\`\`\`mermaid
flowchart ${direction}
${links}
\`\`\`
`,
		);
		const html = readFileSync(output, "utf8");
		const copies = [
			...html.matchAll(/<svg (?:data-phone (?:data-print )?)?id="mm0(?:-phone)?"[\s\S]*?<\/svg>/g),
		];
		expect(copies).toHaveLength(direction === "LR" ? 2 : 1);
		expect(copies.flatMap(([svg]) => crossings(svg))).toEqual([]);
	},
);
