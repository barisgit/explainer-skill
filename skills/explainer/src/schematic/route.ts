/**
 * Orthogonal wire routing on the 10-unit grid for parts the author placed: each net grows as a tree, joining its nearest
 * unjoined pin by an A* search that leaves and enters pins only along their exit direction, never runs through a part or along
 * another net's wire, crosses other nets only straight across, and pays for bends and crossings so wires stay plain.
 */
import { type Box, grow, type Point, union } from "./geometry.ts";
import { exitOf, extentOf, type Part, pinAt, type Wire } from "./scene.ts";
import { G } from "./symbols.ts";

const BEND = 3;
const CROSS = 6;
const NEAR = 1;

const DIRS: Point[] = [
	{ x: 1, y: 0 },
	{ x: -1, y: 0 },
	{ x: 0, y: 1 },
	{ x: 0, y: -1 },
];

const k = (x: number, y: number) => `${x},${y}`;

/** What occupies a grid point: a net, which axes its wire runs along there, and whether it ends, turns or joins there. */
interface Use {
	net: string;
	h: boolean;
	v: boolean;
	node: boolean;
}

/** A pin as the router sees it: grid point and exit direction. */
interface Terminal {
	at: Point;
	exit: Point;
	name: string;
	/** The netlist line of the pin's part, for problems. */
	line: number;
}

class Heap<T> {
	private items: Array<{ cost: number; item: T }> = [];
	get size() {
		return this.items.length;
	}
	push(cost: number, item: T) {
		this.items.push({ cost, item });
		let i = this.items.length - 1;
		while (i > 0) {
			const up = (i - 1) >> 1;
			const [a, b] = [this.items[up], this.items[i]];
			if (!a || !b || a.cost <= b.cost) {
				break;
			}
			[this.items[up], this.items[i]] = [b, a];
			i = up;
		}
	}
	pop(): T | undefined {
		const top = this.items[0];
		const last = this.items.pop();
		if (this.items.length && last) {
			this.items[0] = last;
			this.sink(0);
		}
		return top?.item;
	}
	private sink(start: number) {
		let i = start;
		for (;;) {
			const [l, r] = [2 * i + 1, 2 * i + 2];
			let m = i;
			if ((this.items[l]?.cost ?? Infinity) < (this.items[m]?.cost ?? Infinity)) {
				m = l;
			}
			if ((this.items[r]?.cost ?? Infinity) < (this.items[m]?.cost ?? Infinity)) {
				m = r;
			}
			const [a, b] = [this.items[i], this.items[m]];
			if (m === i || !a || !b) {
				return;
			}
			[this.items[i], this.items[m]] = [b, a];
			i = m;
		}
	}
}

/** The sheet as a grid: blocked points (inside parts), points near parts, and what the routed wires occupy. */
class Board {
	readonly blocked = new Set<string>();
	readonly near = new Set<string>();
	readonly uses = new Map<string, Use[]>();
	readonly bounds: Box;

	constructor(parts: Part[]) {
		const extents = parts.map(extentOf);
		this.bounds = grow(union(extents), 4 * G);
		for (const box of extents) {
			this.mark(box, 0, this.blocked);
			this.mark(box, G, this.near);
		}
	}

	private mark(box: Box, by: number, into: Set<string>) {
		const b = grow(box, by);
		for (let x = Math.ceil(b.x0 / G); x <= Math.floor(b.x1 / G); x++) {
			for (let y = Math.ceil(b.y0 / G); y <= Math.floor(b.y1 / G); y++) {
				into.add(k(x, y));
			}
		}
	}

	inside(x: number, y: number) {
		return (
			x * G >= this.bounds.x0 &&
			x * G <= this.bounds.x1 &&
			y * G >= this.bounds.y0 &&
			y * G <= this.bounds.y1
		);
	}

	othersAt(x: number, y: number, net: string) {
		return (this.uses.get(k(x, y)) ?? []).filter((u) => u.net !== net);
	}

	ownAt(x: number, y: number, net: string) {
		return (this.uses.get(k(x, y)) ?? []).some((u) => u.net === net);
	}

	/** Records a routed polyline's every grid point for `net`, so a later wire cannot run through the straight parts. */
	occupy(corners: Point[], net: string) {
		const points = expand(corners);
		points.forEach((p, i) => {
			const prev = points[i - 1];
			const next = points[i + 1];
			const h = (prev && prev.y === p.y) || (next && next.y === p.y);
			const v = (prev && prev.x === p.x) || (next && next.x === p.x);
			const turn = Boolean(prev && next && (prev.x === next.x) !== (prev.x === p.x));
			const use = { net, h: Boolean(h), v: Boolean(v), node: !prev || !next || turn };
			this.uses.set(k(p.x, p.y), [...(this.uses.get(k(p.x, p.y)) ?? []), use]);
		});
	}
}

interface State {
	x: number;
	y: number;
	d: number;
	cost: number;
	from?: State;
}

/** Whether a step from (x, y) in direction `dir` onto the next point is allowed, and what it costs beyond 1. */
function stepCost(
	board: Board,
	net: string,
	to: Point,
	dir: Point,
	goals: Map<string, Point | null>,
): number | undefined {
	const goal = goals.get(k(to.x, to.y));
	if (goal !== undefined) {
		// A pin is entered against its exit direction only (a terminal, with none, from anywhere); a wire of the net anywhere.
		const free = goal === null || (goal.x === 0 && goal.y === 0);
		return free || (goal.x === -dir.x && goal.y === -dir.y) ? 0 : undefined;
	}
	if (!board.inside(to.x, to.y) || board.blocked.has(k(to.x, to.y))) {
		return undefined;
	}
	const others = board.othersAt(to.x, to.y, net);
	if (others.some((u) => u.node || (dir.x ? u.h : u.v))) {
		return undefined;
	}
	return (others.length ? CROSS : 0) + (board.near.has(k(to.x, to.y)) ? NEAR : 0);
}

/** One A* search: the open heap, the best cost seen per point and direction, and what a step may enter. */
interface Search {
	board: Board;
	net: string;
	goals: Map<string, Point | null>;
	heap: Heap<State>;
	best: Map<string, number>;
}

/** Pushes the states one step on from `s`: the start leaves along its pin's exit (if it has one), and no step turns back. */
function expandState(search: Search, s: State, first: number) {
	const choices = s.from || first < 0 ? DIRS.keys() : [first].values();
	const back = DIRS[s.d];
	for (const d of choices) {
		const dir = DIRS[d] ?? { x: 0, y: 0 };
		if (s.from && back && dir.x === -back.x && dir.y === -back.y) {
			continue;
		}
		const to = { x: s.x + dir.x, y: s.y + dir.y };
		const extra = stepCost(search.board, search.net, to, dir, search.goals);
		if (extra === undefined) {
			continue;
		}
		const cost = s.cost + 1 + extra + (s.from && d !== s.d ? BEND : 0);
		const id = `${to.x},${to.y},${d}`;
		if (cost < (search.best.get(id) ?? Infinity)) {
			search.best.set(id, cost);
			search.heap.push(cost + nearestGoal(to, search.goals), { ...to, d, cost, from: s });
		}
	}
}

/** The cheapest path from a pin to any goal, as grid points; undefined when none exists. */
function search(
	board: Board,
	net: string,
	start: Terminal,
	goals: Map<string, Point | null>,
): Point[] | undefined {
	const open: Search = { board, net, goals, heap: new Heap<State>(), best: new Map() };
	const first = DIRS.findIndex((d) => d.x === start.exit.x && d.y === start.exit.y);
	open.heap.push(0, { x: start.at.x, y: start.at.y, d: first, cost: 0 });
	for (let s = open.heap.pop(); s; s = open.heap.pop()) {
		if (goals.has(k(s.x, s.y)) && s.from) {
			return trace(s);
		}
		expandState(open, s, first);
	}
	return undefined;
}

const nearestGoal = (p: Point, goals: Map<string, Point | null>) => {
	let least = Infinity;
	for (const g of goals.keys()) {
		const [x, y] = g.split(",").map(Number);
		least = Math.min(least, Math.abs((x ?? 0) - p.x) + Math.abs((y ?? 0) - p.y));
	}
	return least;
};

/** A found path's corners, start first. */
function trace(end: State): Point[] {
	const points: Point[] = [];
	for (let s: State | undefined = end; s; s = s.from) {
		points.unshift({ x: s.x, y: s.y });
	}
	return points.filter((p, i) => {
		const prev = points[i - 1];
		const next = points[i + 1];
		return (
			!prev ||
			!next ||
			(prev.x === p.x) !== (p.x === next.x) ||
			(prev.y === p.y) !== (p.y === next.y)
		);
	});
}

/** A pin as a router terminal, in grid units. */
function terminalOf(part: Part, pin: string): Terminal {
	const at = pinAt(part, pin) ?? part.at;
	return {
		at: { x: Math.round(at.x / G), y: Math.round(at.y / G) },
		exit: exitOf(part, pin),
		name: `${part.id}.${pin}`,
		line: part.line,
	};
}

/**
 * Pins placed on a pin of their net (R2's top on R1's bottom) as one terminal, joined already, that a wire may reach from any
 * side its parts leave free.
 */
function joinCoincident(terminals: Terminal[]): Terminal[] {
	const byPoint = new Map<string, Terminal>();
	for (const t of terminals) {
		const seen = byPoint.get(k(t.at.x, t.at.y));
		byPoint.set(k(t.at.x, t.at.y), seen ? { ...seen, exit: { x: 0, y: 0 } } : t);
	}
	return [...byPoint.values()];
}

/** Routes one net: pins joined nearest first, each to the tree so far. */
function routeNet(board: Board, net: string, terminals: Terminal[], problems: string[]): Wire[] {
	const wires: Wire[] = [];
	const [root, ...rest] = joinCoincident(terminals);
	if (!root) {
		return wires;
	}
	const goals = new Map<string, Point | null>([[k(root.at.x, root.at.y), root.exit]]);
	const todo = [...rest];
	while (todo.length) {
		todo.sort((a, b) => nearestGoal(a.at, goals) - nearestGoal(b.at, goals));
		const next = todo.shift();
		if (!next) {
			break;
		}
		const path = search(board, net, next, goals);
		if (!path) {
			problems.push(
				`line ${next.line}: no free route for net ${net} to ${next.name}; leave room around that pin, or turn the part`,
			);
			continue;
		}
		board.occupy(path, net);
		wires.push({ net, points: path.map((p) => ({ x: p.x * G, y: p.y * G })) });
		// Once wired, a pin is a node of the net like any wire point: a later wire may join it from any side, as a T.
		for (const p of expand(path)) {
			goals.set(k(p.x, p.y), null);
		}
	}
	return wires;
}

/** Every grid point along a polyline of corners. */
function expand(corners: Point[]): Point[] {
	const out: Point[] = [];
	corners.forEach((p, i) => {
		const next = corners[i + 1];
		out.push(p);
		if (next) {
			const dx = Math.sign(next.x - p.x);
			const dy = Math.sign(next.y - p.y);
			for (let x = p.x + dx, y = p.y + dy; x !== next.x || y !== next.y; x += dx, y += dy) {
				out.push({ x, y });
			}
		}
	});
	return out;
}

/**
 * Routes every net among the placed parts (ground symbols included) and the wires already laid, shortest nets first so short
 * local wires take the direct paths.
 */
export function routeNets(
	parts: Part[],
	nets: Map<string, Array<{ part: Part; pin: string }>>,
	laid: Wire[],
	problems: string[],
): Wire[] {
	const board = new Board(parts);
	for (const w of laid) {
		board.occupy(
			w.points.map((p) => ({ x: p.x / G, y: p.y / G })),
			w.net,
		);
	}
	const span = (pins: Array<{ part: Part; pin: string }>) => {
		const ts = pins.map((p) => terminalOf(p.part, p.pin).at);
		return (
			Math.max(...ts.map((t) => t.x)) -
			Math.min(...ts.map((t) => t.x)) +
			Math.max(...ts.map((t) => t.y)) -
			Math.min(...ts.map((t) => t.y))
		);
	};
	const order = [...nets]
		.filter(([, pins]) => pins.length > 1)
		.sort((a, b) => span(a[1]) - span(b[1]));
	return order.flatMap(([net, pins]) =>
		routeNet(
			board,
			net,
			pins.map((p) => terminalOf(p.part, p.pin)),
			problems,
		),
	);
}
