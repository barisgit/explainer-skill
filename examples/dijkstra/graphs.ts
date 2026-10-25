/* The page's maps. Node positions are SVG units; an edge is [from, to, weight]. Roads run both ways unless `directed`. */

export interface GraphNode {
	id: string;
	x: number;
	y: number;
}

export type Edge = readonly [from: string, to: string, weight: number];

export interface Graph {
	nodes: GraphNode[];
	edges: Edge[];
	directed?: boolean;
}

const asNodes = (list: [string, number, number][]): GraphNode[] =>
	list.map(([id, x, y]) => ({ id, x, y }));

const TOWNS_NODES = asNodes([
	["A", 50, 170],
	["B", 180, 70],
	["C", 180, 270],
	["D", 330, 170],
	["E", 470, 70],
	["F", 470, 270],
	["G", 595, 170],
]);
const TOWNS_EDGES: Edge[] = [
	["A", "B", 4],
	["A", "C", 2],
	["B", "C", 1],
	["B", "D", 5],
	["C", "D", 8],
	["C", "F", 10],
	["D", "E", 2],
	["D", "F", 6],
	["E", "G", 3],
	["F", "G", 2],
];

const TOWNS: Graph = { nodes: TOWNS_NODES, edges: TOWNS_EDGES };

/** The maps of the main explorer, in the order of its Map switch. */
export const MAPS: { id: string; name: string; graph: Graph }[] = [
	{ id: "towns", name: "Seven towns", graph: TOWNS },
	{
		id: "grid",
		name: "Street grid",
		graph: {
			// A 3 x 3 grid of junctions A..I, read row by row.
			nodes: ["ABC", "DEF", "GHI"].flatMap((row, r) =>
				[...row].map((id, c) => ({ id, x: 110 + c * 210, y: 50 + r * 120 })),
			),
			edges: [
				["A", "B", 3],
				["B", "C", 2],
				["D", "E", 6],
				["E", "F", 1],
				["G", "H", 2],
				["H", "I", 4],
				["A", "D", 1],
				["D", "G", 5],
				["B", "E", 2],
				["E", "H", 7],
				["C", "F", 4],
				["F", "I", 1],
			],
		},
	},
	{
		id: "islands",
		name: "Two islands",
		graph: {
			nodes: asNodes([
				["A", 70, 170],
				["B", 200, 80],
				["C", 200, 260],
				["D", 440, 80],
				["E", 440, 260],
				["F", 570, 170],
			]),
			edges: [
				["A", "B", 3],
				["A", "C", 5],
				["B", "C", 1],
				["D", "E", 2],
				["D", "F", 4],
				["E", "F", 3],
			],
		},
	},
	{
		id: "equal",
		name: "All roads equal",
		graph: { nodes: TOWNS_NODES, edges: TOWNS_EDGES.map(([a, b]): Edge => [a, b, 1]) },
	},
];

/** The graph of the map with this id. */
export const mapGraph = (id: string): Graph => MAPS.find((m) => m.id === id)?.graph ?? TOWNS;

/** The one-way graph of the negative-edge section; only road B→A changes. */
export const negGraph = (w: number): Graph => ({
	directed: true,
	nodes: asNodes([
		["S", 70, 170],
		["A", 300, 70],
		["B", 300, 270],
		["C", 540, 70],
	]),
	edges: [
		["S", "A", 3],
		["S", "B", 4],
		["B", "A", w],
		["A", "C", 2],
	],
});
