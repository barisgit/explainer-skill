/*
 * Sets of controls and the values chosen in them, shared by the islands that show or follow a set: an Explore's own controls,
 * or those a Controls declares for the Explores with `use`. One module serves pack's render and the browser's, where every
 * island is in one bundle, so the islands reach the same sets; Controls' island declares its set as it renders, before the
 * islands after it in the page.
 */
import { useEffect, useState } from "preact/hooks";
import type { ExploreControl } from "./explore-view.tsx";

/** A row of controls and the index of the value chosen for each; the islands that show or follow it listen for a choice. */
export interface ControlSet {
	controls: ExploreControl[];
	start: number[];
	values: number[];
	listeners: Set<() => void>;
}

/** A set starting on `start`: an Explore's own controls, or the set a Controls declares. */
export const newControlSet = (controls: ExploreControl[], start: number[]): ControlSet => ({
	controls,
	start,
	values: start,
	listeners: new Set(),
});

/** `values` with index `c` replaced by `value`. */
export const withValue = (values: number[], c: number, value: number): number[] =>
	values.map((old, i) => (i === c ? value : old));

const sets = new Map<string, ControlSet>();

/** The id of the element that shows the set `id`'s controls, which the Explores that follow it link to. */
export const anchorOf = (id: string): string => `${id}-controls`;

/** The ids of the sets declared so far, for messages. */
export const declaredSets = (): string[] => [...sets.keys()];

/** The set called `id`, or undefined when no Controls with that id has rendered yet. */
export const sharedControls = (id: string): ControlSet | undefined => sets.get(id);

/**
 * Declares the set `id` with its `controls` (the island's props, so the same array on every render of it) and returns it;
 * declaring it again with the same array is the island rendering again. A second Controls with the id is an error.
 */
export function declareControls(
	id: string,
	controls: ExploreControl[],
	start: number[],
): ControlSet {
	const known = sets.get(id);
	if (!known) {
		const declared = newControlSet(controls, start);
		sets.set(id, declared);
		return declared;
	}
	if (known.controls !== controls) {
		throw new Error(`<Controls id="${id}"> is on the page twice: give each set its own id`);
	}
	return known;
}

/** The indices chosen in `set` and the function that chooses one, re-rendering the island on a change. */
export function useControlSet(set: ControlSet): [number[], (c: number, value: number) => void] {
	const [values, setValues] = useState(set.values);
	// A choice made after this render and before the effect (keep restoring inputs as the page loads) is picked up here.
	useEffect(() => {
		const follow = () => setValues(set.values);
		set.listeners.add(follow);
		follow();
		return () => {
			set.listeners.delete(follow);
		};
	}, [set]);
	return [
		values,
		(c, value) => {
			set.values = withValue(set.values, c, value);
			for (const listener of set.listeners) {
				listener();
			}
		},
	];
}
