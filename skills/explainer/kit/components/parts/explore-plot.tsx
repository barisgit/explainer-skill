"use client";
/* Explore with a Plot (see ../explore.tsx): its own client module, so the page carries plot.js and not ECharts. */
import { useRef } from "preact/hooks";
import { Plot } from "../plot.tsx";
import { type ExploreData, type ExplorePick, ExploreView } from "./explore-view.tsx";
import { PickStrip } from "./pick-strip.tsx";

/** The plot, and under it the strip of an axis choice the Explore shows itself. */
function Figure({
	data,
	option,
	pick,
}: {
	data: ExploreData;
	option: PlotOption;
	pick: ExplorePick | undefined;
}) {
	const strip = useRef<HTMLDivElement>(null);
	return (
		<>
			<Plot
				option={option}
				{...(pick && { pick: { choose: pick.choose, ...(pick.strip && { strip }) } })}
				label={data.label}
				{...(data.class ? { class: data.class } : {})}
				{...(data.height ? { height: data.height } : {})}
			/>
			{pick?.strip && (
				<PickStrip box={strip} strip={pick.strip} at={option.pick ?? 0} choose={pick.choose} />
			)}
		</>
	);
}

export function Explore(data: ExploreData) {
	return (
		<ExploreView
			data={data}
			figure={(option, pick) => <Figure data={data} option={option as PlotOption} pick={pick} />}
		/>
	);
}
