"use client";
/* Controls' island (see ../explore.tsx): the row of controls that every Explore with `use` of its id follows. */
import { ControlRow, type ExploreControl } from "./explore-view.tsx";
import { anchorOf, declareControls, useControlSet } from "./shared-controls.ts";

export function Controls({
	id,
	controls,
	start,
}: {
	id: string;
	controls: ExploreControl[];
	start: number[];
}) {
	const [values, choose] = useControlSet(declareControls(id, controls, start));
	return (
		<div class="fig" id={anchorOf(id)}>
			<ControlRow controls={controls} values={values} set={choose} />
		</div>
	);
}
