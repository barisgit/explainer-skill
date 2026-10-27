/*
 * The place a Controls and the Explores that follow it share: the page outside every View, one View, or one record of a filled
 * View. A reader changes the controls of the place they are looking at, so a `use` finds its Controls only there. A View
 * and a record provide their place as context; a client component is a render root of its own, so pack and the browser
 * give it the place of the View it sits in (kit/islands), and the page's when it sits outside every View.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ControlSet } from "./shared-controls.ts";

/** The sets of Controls declared in one place, by id. `name` is "" for the page, else the View's route. */
export interface Place {
	name: string;
	sets: Map<string, ControlSet>;
}

export const PlaceContext = createContext<Place | undefined>(undefined);

/** A place no View or page names: each time a record is drawn, so its Controls start afresh and cannot collide. */
export const anonymousPlace = (): Place => ({ name: "", sets: new Map() });

const named = new Map<string, Place>();

/** The page's place (`name` ""), or the one of the View with that route; the same place on every call. */
export function placeNamed(name: string): Place {
	const known = named.get(name) ?? { name, sets: new Map() };
	named.set(name, known);
	return known;
}

/** The place a component renders in: the one a View or record provided, else the page's. */
export const usePlace = (): Place => useContext(PlaceContext) ?? placeNamed("");
