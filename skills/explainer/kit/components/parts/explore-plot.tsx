"use client";
/* Explore with a Plot (see ../explore.tsx): its own client module, so the page carries plot.js and not ECharts. */
import { Plot } from "../plot.tsx";
import { type ExploreData, ExploreView } from "./explore-view.tsx";

export function Explore(data: ExploreData) {
	return (
		<ExploreView
			data={data}
			figure={(option) => (
				<Plot
					option={option as PlotOption}
					label={data.label}
					{...(data.class ? { class: data.class } : {})}
					{...(data.height ? { height: data.height } : {})}
				/>
			)}
		/>
	);
}
