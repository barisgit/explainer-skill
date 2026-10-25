/* The parts the overview and the algorithm views draw from the cheat sheet's data. Rendered once when the page packs. */
import { ALGOS, type AlgoId } from "./owasp.ts";

/** The overview's comparison: one row per algorithm, its name linking to the algorithm's view. */
export function AlgoTable() {
	return (
		<table class="compare">
			<thead>
				<tr>
					<th>Algorithm</th>
					<th>OWASP's role for it</th>
					<th>Minimum setting</th>
					<th>Nominal memory</th>
					<th>FIPS-140 validated</th>
					<th>Watch out for</th>
				</tr>
			</thead>
			<tbody>
				{Object.entries(ALGOS).map(([id, a]) => (
					<tr data-state={a.state}>
						<th scope="row">
							<a href={`#algo/${id}`}>{a.name}</a>
						</th>
						<td data-label="OWASP's role">{a.role}</td>
						<td data-label="Minimum setting">{a.minimum}</td>
						<td data-label="Nominal memory">{a.memory}</td>
						<td data-label="FIPS-140 validated">{a.fips}</td>
						<td data-label="Watch out for">{a.watch}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

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

/** Every OWASP setting of an algorithm. */
export function Settings({ algo }: { algo: AlgoId }) {
	return (
		<table class="compare">
			<thead>
				<tr>
					<th>Setting</th>
					<th>Nominal memory</th>
					<th>Trade-off</th>
				</tr>
			</thead>
			<tbody>
				{ALGOS[algo].settings.map(([setting, memory, tradeOff]) => (
					<tr>
						<th scope="row">{setting}</th>
						<td data-label="Nominal memory">{memory}</td>
						<td data-label="Trade-off">{tradeOff}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
