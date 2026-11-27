import { expect, test } from "bun:test";
import { copiesOf } from "./support.ts";

type Point = { x: number; y: number };
type Box = Point & { id: string; width: number; height: number };

/** A cubic from `from` through control points `n` (x1 y1 x2 y2 x y), sampled at 16 steps. */
function cubic(from: Point, n: number[]): Point[] {
	const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = n;
	return Array.from({ length: 16 }, (_, i) => {
		const t = (i + 1) / 16;
		const u = 1 - t;
		return {
			x: u * u * u * from.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
			y: u * u * u * from.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
		};
	});
}

/** Where a one-point command (M, L, H or V) with arguments `n` moves the pen from `at`. */
const step = (command: string, n: number[], at: Point): Point =>
	command === "H"
		? { x: n[0] ?? 0, y: at.y }
		: command === "V"
			? { x: at.x, y: n[0] ?? 0 }
			: { x: n[0] ?? 0, y: n[1] ?? 0 };

/** The corners of an SVG path of M, L, H, V and C commands (absolute), each cubic sampled. */
function corners(d: string): Point[] {
	const points: Point[] = [];
	let at: Point = { x: 0, y: 0 };
	for (const [, command = "", args = ""] of d.matchAll(/([MLHVC])([^MLHVC]*)/g)) {
		const n = (args.match(/-?[\d.]+/g) ?? []).map(Number);
		const next = command === "C" ? cubic(at, n) : [step(command, n, at)];
		points.push(...next);
		at = next.at(-1) ?? at;
	}
	return points;
}

/** Points along an SVG path, every 2 px on its straight runs, so a long segment cannot jump a box. */
function samples(d: string): Point[] {
	const points = corners(d);
	return points.flatMap((b, i) => {
		const a = points[i - 1];
		if (!a) {
			return [b];
		}
		const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
		return Array.from({ length: steps }, (_, k) => ({
			x: a.x + ((b.x - a.x) * (k + 1)) / steps,
			y: a.y + ((b.y - a.y) * (k + 1)) / steps,
		}));
	});
}

/** Each edge that passes through a node it does not join: its line may meet a box's edge, never its inside. */
function crossings(svg: string): string[] {
	const nodes: Box[] = [
		...svg.matchAll(
			/class="pele-node[^"]*" data-id="([^"]+)"[^>]*transform="translate\(([\d.-]+),([\d.-]+)\)">\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g,
		),
	].map(([, id = "", cx, cy, x, y, width, height]) => ({
		id,
		x: Number(cx) + Number(x),
		y: Number(cy) + Number(y),
		width: Number(width),
		height: Number(height),
	}));
	const edges = [
		...svg.matchAll(
			/<g class="pele-edge" data-id="L_([^_"]+)_([^_"]+)_\d+"[^>]*>\s*<path d="([^"]+)"/g,
		),
	];
	expect(nodes).toHaveLength(6);
	expect(edges).toHaveLength(6);
	const inside = (p: Point, box: Box) =>
		p.x > box.x + 1 &&
		p.x < box.x + box.width - 1 &&
		p.y > box.y + 1 &&
		p.y < box.y + box.height - 1;
	return edges.flatMap(([, from, to, d = ""]) => {
		const points = samples(d);
		return nodes
			.filter((box) => box.id !== from && box.id !== to && points.some((p) => inside(p, box)))
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
	"$direction $bundle routes skip edges clear of every node, in every copy",
	({ direction, links }) => {
		const copies = copiesOf(`flowchart ${direction}\n${links}`);
		expect(copies.length).toBeGreaterThan(0);
		expect(copies.flatMap(crossings)).toEqual([]);
	},
);
