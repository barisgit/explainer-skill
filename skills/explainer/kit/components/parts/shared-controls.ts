/*
 * The sets of controls that Controls declares and the Explores with `use` follow: each set's controls and starting indices, and
 * the indices the reader has chosen. One module serves pack's render and the browser's, where every island is in one bundle, so
 * the islands reach the same sets. Controls' island declares its set as it renders, before the islands after it in the page.
 */
import { useEffect, useState } from "preact/hooks";
import type { ExploreControl } from "./explore-view.tsx";

/** One set of controls: what the page declared and the index of the value chosen for each control. */
export interface SharedControls {
	id: string;
	controls: ExploreControl[];
	start: number[];
	values: number[];
	listeners: Set<() => void>;
}

const sets = new Map<string, SharedControls>();

/** The id of the element that shows the set `id`'s controls, which the Explores that follow it link to. */
export const anchorOf = (id: string): string => `${id}-controls`;

/** The ids of the sets declared so far, for messages. */
export const declaredSets = (): string[] => [...sets.keys()];

/** The set called `id`, or undefined when no Controls with that id has rendered yet. */
export const sharedControls = (id: string): SharedControls | undefined => sets.get(id);

/**
 * Declares the set `id` with its `controls` (the island's props, so the same array on every render of it) and returns it;
 * declaring it again with the same array is the island rendering again. A second Controls with the id is an error.
 */
export function declareControls(
	id: string,
	controls: ExploreControl[],
	start: number[],
): SharedControls {
	const known = sets.get(id);
	if (known) {
		if (known.controls !== controls) {
			throw new Error(`<Controls id="${id}"> is on the page twice: give each set its own id`);
		}
		return known;
	}
	const declared = { id, controls, start, values: start, listeners: new Set<() => void>() };
	sets.set(id, declared);
	return declared;
}

/** Chooses value index `value` for control `c` of `set`, and tells every island that follows the set. */
function choose(set: SharedControls, c: number, value: number) {
	set.values = set.values.map((old, i) => (i === c ? value : old));
	for (const listener of set.listeners) {
		listener();
	}
}

/**
 * The indices chosen in `set` and the function that chooses one, re-rendering the island on a change. Nothing when `set` is
 * undefined (an Explore with its own controls), so a component calls it with no condition around the hook.
 */
export function useShared(
	set: SharedControls | undefined,
): [number[] | undefined, (c: number, value: number) => void] {
	const [values, setValues] = useState(set?.values);
	// A choice made after this render and before the effect (keep restoring inputs as the page loads) is picked up here.
	useEffect(() => {
		if (!set) {
			return undefined;
		}
		const follow = () => setValues(set.values);
		set.listeners.add(follow);
		follow();
		return () => {
			set.listeners.delete(follow);
		};
	}, [set]);
	return [values, (c, value) => set && choose(set, c, value)];
}
