"use client";
/* Controls' island (see ../explore.tsx): the row of controls that every Explore with `use` of its id follows. */
import { ControlRow, type ExploreControl } from "./explore-view.tsx";
import { anchorOf, declareControls, useShared } from "./shared-controls.ts";

export function Controls({
	id,
	controls,
	start,
}: {
	id: string;
	controls: ExploreControl[];
	start: number[];
}) {
	const set = declareControls(id, controls, start);
	const [values, choose] = useShared(set);
	return (
		<div class="fig" id={anchorOf(id)}>
			<ControlRow controls={controls} values={values ?? start} set={choose} />
		</div>
	);
}
