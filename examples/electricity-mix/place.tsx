"use client";
/* The drill-down view at #place/<slug>: page.mdx fills one View from PLACE_RECORDS, and the kit draws the open place with
   PlaceView, so the page carries the data once instead of 223 views' markup. */
import { MixFigure } from "./figures.tsx";
import {
	COAL,
	cell,
	fmtT,
	type Place,
	partialYears,
	pc,
	placeOf,
	SOURCES,
	share,
	sumShare,
	total,
	twh,
	YEARS,
} from "./model.ts";

/** The sentence about coal, checked against every year rather than the two endpoints. */
function coalSentence(place: Place, a: number, b: number) {
	const shares = YEARS.flatMap((y) => {
		const s = share(place, COAL, y);
		return s === null ? [] : [{ y, s }];
	});
	const peak = shares.reduce((best, cur) => (cur.s > best.s ? cur : best), { y: a, s: 0 });
	if (peak.s === 0) {
		return " It generated no electricity from coal in any year.";
	}
	const [sa, sb] = [share(place, COAL, a), share(place, COAL, b)];
	const between =
		peak.y !== a && peak.y !== b && peak.s > Math.max(sa ?? 0, sb ?? 0) + 0.5
			? `, with a peak of ${peak.s.toFixed(0)}% in ${peak.y}`
			: "";
	return ` Coal supplied ${pc(sa)} in ${a} and ${pc(sb)} in ${b}${between}.`;
}

/** The first and last year the place has a total for. */
function span(place: Place) {
	const years = YEARS.filter((y) => total(place, y) !== null);
	return [years[0] ?? YEARS[0] ?? 0, years.at(-1) ?? 0] as const;
}

/** The lede: how much the place generated in its last year, its largest source, and coal's course. */
function lede(place: Place) {
	const [a, b] = span(place);
	const partial = partialYears(place);
	const range = partial.length > 1 ? `${partial[0]} to ${partial.at(-1)}` : partial[0];
	const partialNote = partial.length
		? ` The release splits only part of the total by source in ${range}; the grey band is the rest.`
		: "";
	if (!total(place, b)) {
		return `${place.name} reported no electricity generation in ${b}, so shares are undefined.${partialNote}`;
	}
	const biggest = SOURCES.reduce((best, s) =>
		(twh(place, s, b) ?? 0) > (twh(place, best, b) ?? 0) ? s : best,
	);
	return `${place.name} generated ${cell(total(place, b), fmtT)} TWh of electricity in ${b}; ${biggest.name.toLowerCase()} was the largest source at ${pc(share(place, biggest, b))}.${coalSentence(place, a, b)}${partialNote}`;
}

/** One place's view: its name, the lede, its numbers and its stacked mix. */
export function PlaceView({ record }: { record: { id: string } }) {
	const place = placeOf(record.id);
	if (!place) {
		return null;
	}
	const [a, b] = span(place);
	const pair = (ids: string[], digits = 0) =>
		`${pc(sumShare(place, ids, a), digits)} → ${pc(sumShare(place, ids, b), digits)}`;
	return (
		<>
			<h1>{place.name}</h1>
			<p>{lede(place)}</p>
			<dl class="stats" aria-live="polite">
				<div class="stat">
					<dt>Generation in {b}</dt>
					<dd>
						{cell(total(place, b), fmtT)} <small>TWh, was {cell(total(place, a), fmtT)}</small>
					</dd>
				</div>
				<div class="stat">
					<dt>Coal's share</dt>
					<dd>{pair(["coal"])}</dd>
				</div>
				<div class="stat">
					<dt>Wind and solar's share</dt>
					<dd>{pair(["wind", "solar"], 1)}</dd>
				</div>
				<div class="stat">
					<dt>Nuclear and hydro's share</dt>
					<dd>{pair(["nuclear", "hydro"])}</dd>
				</div>
			</dl>
			<MixFigure
				place={place}
				name="pmode"
				id="place-chart"
				label={`Stacked areas of ${place.name}'s electricity generation by source, ${a} to ${b}`}
				caption="Click a legend entry to hide a source. Data: Our World in Data (CC BY 4.0), from Ember and the Energy Institute; see the method notes on the main page."
			/>
		</>
	);
}
