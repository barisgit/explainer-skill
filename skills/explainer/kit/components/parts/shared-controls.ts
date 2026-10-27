/*
 * Sets of controls and the values chosen in them, shared by the islands that show or follow a set: an Explore's own controls,
 * or those a Controls declares for the Explores with `use`. One module serves pack's render and the browser's, where every
 * island is in one bundle, so the islands of a place (place.ts) reach the same sets; Controls' island declares its set as it
 * renders, before the islands after it in the place.
 */
import { useEffect, useState } from "preact/hooks";
import type { ExploreControl } from "./control.ts";
import type { Place } from "./place.ts";

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

/** The id of the element that shows the set `id`'s controls, which the Explores that follow it link to. */
export const anchorOf = (id: string): string => `${id}-controls`;

/** The set called `id` in `place`, or undefined when no Controls with that id has rendered there yet. */
export const sharedControls = (place: Place, id: string): ControlSet | undefined =>
	place.sets.get(id);

/**
 * The set `id` of `place` for a Controls island: made on its first render and kept for as long as the island is mounted, so a
 * re-render of the island or of its parent finds the same set, and a Controls shown again later starts afresh.
 */
export function useDeclaredControls(
	place: Place,
	id: string,
	controls: ExploreControl[],
	start: number[],
): ControlSet {
	const [set] = useState(() => {
		const declared = place.sets.get(id) ?? newControlSet(controls, start);
		place.sets.set(id, declared);
		return declared;
	});
	useEffect(
		() => () => {
			if (place.sets.get(id) === set) {
				place.sets.delete(id);
			}
		},
		[place, id, set],
	);
	return set;
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
