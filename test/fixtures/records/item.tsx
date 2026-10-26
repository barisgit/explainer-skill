"use client";
/* One work item of the RC-2 plan, as the filled item view shows it. */

/** A work item as the plan's data holds it. */
export interface WorkItem {
	id: string;
	title: string;
	phase: string;
	package: string;
	owner: string;
	likely: number;
	high: number;
	labour: number;
	rationale: string;
}

const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const euros = new Intl.NumberFormat("en", {
	style: "currency",
	currency: "EUR",
	maximumFractionDigits: 0,
});

export function Item({ record }: { record: WorkItem }) {
	return (
		<>
			<h1>
				{record.id} {record.title}
			</h1>
			<p>
				Phase {record.phase}, {record.package}, owned by {record.owner}.
			</p>
			<section>
				<h2>Estimate</h2>
				<p>
					{hours.format(record.likely)} h likely, {hours.format(record.high)} h at worst;{" "}
					{euros.format(record.labour)} of labour.
				</p>
				<p>{record.rationale}</p>
			</section>
		</>
	);
}
