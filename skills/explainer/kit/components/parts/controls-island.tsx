"use client";
/* Controls' island (see ../explore.tsx): the row of controls that every Explore with `use` of its id follows. */
import { ControlRow, type ExploreControl } from "./explore-view.tsx";
import { usePlace } from "./place.ts";
import { anchorOf, useControlSet, useDeclaredControls } from "./shared-controls.ts";

export function Controls({
	id,
	controls,
	start,
	scope,
}: {
	id: string;
	controls: ExploreControl[];
	start: number[];
	scope?: string;
}) {
	const set = useDeclaredControls(usePlace(scope), id, controls, start);
	const [values, choose] = useControlSet(set);
	return (
		<div class="fig" id={anchorOf(id)}>
			<ControlRow controls={controls} values={values} set={choose} />
		</div>
	);
}
