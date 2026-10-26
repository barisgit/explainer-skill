"use client";
/* Explore with a TChart (spike; see ../explore.tsx): its own client module, so only a page whose Explore draws one carries TanStack Charts. */
import { TChart, type TChartProps } from "../tchart.tsx";
import { type ExploreData, ExploreView } from "./explore-view.tsx";

export function Explore(data: ExploreData) {
	return (
		<ExploreView
			data={data}
			figure={(definition) => (
				<TChart
					definition={definition as TChartProps["definition"]}
					label={data.label}
					id={`${data.id ?? "explore"}-chart`}
					{...(data.class ? { class: data.class } : {})}
				/>
			)}
		/>
	);
}
