/* The control as the islands of Explore and Controls get it, which every part that shows or follows a set reads. */
/**
 * A control as the island gets it; a range's values are min + i * step, i < texts.length, shown as texts[i]; a choice's are
 * `values`, shown as `choice`.
 */
export type ExploreControl = { id: string; label: string } & (
	| { range: { min: number; step: number; digits: number; texts: string[] } }
	| { choice: string[]; values: string[] }
	| { toggle: true }
);
