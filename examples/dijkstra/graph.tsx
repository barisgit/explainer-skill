/* The three-node graph as hand-built SVG: the kit draws no directed, weighted graph. No ids, so it can be placed twice on a page. */
import { type Dist, distOf, EDGES, type Edge } from "./model.ts";

const POS: Record<string, [number, number]> = { S: [40, 50], A: [260, 50], B: [150, 130] };
/** Where a node is drawn; the graph has only these three. */
const at = (id: string): [number, number] => {
	const p = POS[id];
	if (!p) {
		throw new Error(`no position for node ${id}`);
	}
	return p;
};
const R = 16;
const CENTRE: [number, number] = [150, 77];

/** How an edge is drawn: plain, the path being shown (ink), or the path that is the answer in question (accent). */
export type EdgeLook = "plain" | "ink" | "accent" | "ghost";

export interface GraphProps {
	dist: Dist;
	/** Nodes drawn solid: their distance is final as far as the algorithm is concerned. */
	settled?: string[];
	/** Look per edge, by "S>A"; absent is plain. */
	edges?: Record<string, EdgeLook>;
	/** Nodes whose distance is drawn in the accent. */
	accent?: string[];
}

const show = (d: number) => (Number.isFinite(d) ? String(d) : "∞");

function Arrow({ edge, look }: { edge: Edge; look: EdgeLook }) {
	const [from, to, w] = edge;
	const [x1, y1] = at(from);
	const [x2, y2] = at(to);
	const len = Math.hypot(x2 - x1, y2 - y1);
	const ux = (x2 - x1) / len;
	const uy = (y2 - y1) / len;
	const sx = x1 + ux * R;
	const sy = y1 + uy * R;
	const tx = x2 - ux * R;
	const ty = y2 - uy * R;
	const head = `${tx},${ty} ${tx - ux * 10 - uy * 5},${ty - uy * 10 + ux * 5} ${tx - ux * 10 + uy * 5},${ty - uy * 10 - ux * 5}`;
	// The weight sits off the edge, on the side away from the graph's centre.
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	const side = Math.sign((mx - CENTRE[0]) * -uy + (my - CENTRE[1]) * ux) || -1;
	const lx = mx - uy * 13 * side;
	const ly = my + ux * 13 * side;
	const colour =
		look === "accent" ? "var(--accent)" : look === "ink" ? "var(--ink)" : "var(--rule-strong)";
	const bold = look === "ink" || look === "accent";
	return (
		<g>
			<line
				x1={sx}
				y1={sy}
				x2={tx}
				y2={ty}
				stroke={colour}
				stroke-width={bold ? 3 : 1.5}
				stroke-dasharray={look === "ghost" ? "5 4" : undefined}
			/>
			<polygon points={head} fill={colour} />
			<text
				x={lx}
				y={ly}
				text-anchor="middle"
				dominant-baseline="central"
				fill={bold ? colour : "var(--muted)"}
				font-size="14"
				paint-order="stroke"
				stroke="var(--under)"
				stroke-width="4"
			>
				{String(w).replace("-", "−")}
			</text>
		</g>
	);
}

export function Graph({ dist, settled = [], edges = {}, accent = [] }: GraphProps) {
	return (
		<svg
			viewBox="0 0 300 180"
			role="img"
			aria-label="Graph: S to A weighs 2, S to B weighs 3, B to A weighs minus 2"
			style={{ inlineSize: "100%", maxInlineSize: "22rem", display: "block", margin: "0 auto" }}
		>
			{EDGES.map((e) => (
				<Arrow edge={e} look={edges[`${e[0]}>${e[1]}`] ?? "plain"} />
			))}
			{Object.entries(POS).map(([id, [x, y]]) => {
				const solid = settled.includes(id);
				const lit = accent.includes(id);
				return (
					<g>
						<circle
							cx={x}
							cy={y}
							r={R}
							fill={solid ? "var(--ink)" : "var(--under)"}
							stroke={solid ? "var(--ink)" : "var(--muted)"}
							stroke-width="1.5"
						/>
						<text
							x={x}
							y={y}
							text-anchor="middle"
							dominant-baseline="central"
							font-size="14"
							fill={solid ? "var(--under)" : "var(--ink)"}
						>
							{id}
						</text>
						<text
							x={x}
							y={id === "B" ? y + 34 : y - 30}
							text-anchor="middle"
							dominant-baseline="central"
							font-size="14"
							font-weight="600"
							fill={lit ? "var(--accent)" : "var(--ink)"}
						>
							{show(distOf(dist, id))}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
