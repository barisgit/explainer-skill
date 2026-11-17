/* The strip of radios an Explore's axis choice shows under its plot's columns (see ../explore.tsx), in place of their names. */
import type { RefObject } from "preact";
import { shortTexts } from "./short-texts.ts";

/** The axis choice's radios: named `id` (ids `id-0`, `id-1`, ...), shown as `texts`, worth `values`, the group named `label`. */
export interface PickStripSpec {
	id: string;
	label: string;
	texts: string[];
	values: string[];
}

/**
 * The radios under a bar plot's categories, one per category; plot.js pads the row to their span and, where a text is wider than
 * its category, shows each by its short form (theme.css writes it from data-short, so a reply and keep read the full text), and
 * where those touch, every nth.
 */
export function PickStrip({
	box,
	strip: { id, label, texts, values },
	at,
	choose,
}: {
	box: RefObject<HTMLDivElement>;
	strip: PickStripSpec;
	at: number;
	choose: (i: number) => void;
}) {
	const shorts = shortTexts(texts);
	return (
		<div ref={box} class="plot-strip" role="radiogroup" aria-label={label}>
			{texts.map((text, i) => (
				<label data-full={text} data-short={shorts[i]}>
					<input
						type="radio"
						name={id}
						id={`${id}-${i}`}
						value={values[i]}
						aria-label={text}
						checked={i === at}
						onChange={() => choose(i)}
					/>
					<span class="full">{text}</span>
				</label>
			))}
		</div>
	);
}
