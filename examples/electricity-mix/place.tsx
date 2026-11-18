"use client";
/* The drill-down view at #place/<slug>: page.mdx fills one View from the place records, so the page carries the data once
   instead of 223 views' markup. */
import { Chart } from "kit";
import { addedOption } from "./added.ts";
import { latest, placeOf, signed, Y1 } from "./model.ts";

/** One place's view: its name, what the last year did to it, and the page's yearly figure for it. */
export function PlaceView({ record }: { record: { id: string } }) {
	const place = placeOf(record.id);
	if (!place) {
		return null;
	}
	const s = latest(place);
	return (
		<>
			<h1>{place.name}</h1>
			<p>
				{s
					? `In ${Y1} generation changed by ${signed(s.total)} TWh: wind and solar ${signed(s.windSolar)}, coal ${signed(s.coal)}.`
					: `${place.name} has no complete change for ${Y1}.`}
			</p>
			<Chart
				height="clamp(15rem, 34vw, 20rem)"
				label={`${place.name}: yearly change in electricity generation in TWh, with the wind and solar part`}
				option={addedOption(place)}
			/>
		</>
	);
}
