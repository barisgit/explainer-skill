/* The head of each algorithm view, drawn from the cheat sheet's data. Rendered once when the page packs. */
import { ALGOS, type AlgoId } from "./owasp.ts";

/** The head of an algorithm's view: its role, minimum and memory. */
export function AlgoStats({ algo }: { algo: AlgoId }) {
	const a = ALGOS[algo];
	return (
		<dl class="stats">
			<div class="stat">
				<dt>OWASP's role</dt>
				<dd>{a.role}</dd>
			</div>
			<div class="stat">
				<dt>Minimum setting</dt>
				<dd>{a.minimum}</dd>
			</div>
			<div class="stat">
				<dt>Nominal memory</dt>
				<dd>{a.memory}</dd>
			</div>
		</dl>
	);
}
