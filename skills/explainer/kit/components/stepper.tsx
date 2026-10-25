/* Stepper: a step-through figure over parts (HTML or hand-built SVG) that carry data-step: Back/Play/Next, a scrubber and arrow keys.
   <Stepper start={1} captions={["The queue is empty", "A burst arrives", "The backlog clears"]}>
     <svg viewBox="0 0 90 20"><rect data-step="1" width="20" height="20" /><rect data-step="2 3" x="35" width="20" height="20" /></svg>
   </Stepper>
     children  the parts, HTML or hand-built SVG. data-step="2 4" makes a part appear at step 2 and lit (is-now) on 2 and 4;
               "0 3" is visible from the start and lit at 3; a part without data-step never changes
     captions  one per step, text or JSX; the current one shows. The number of steps is the number of captions, else the highest step used
     captionsFirst  the captions (and the controls over them) before the parts, as text to read before the picture; default after
     start     the opening step. By default the stepper opens on the last step (the complete picture, same as print and without JS);
               study pages start at 1. Play restarts from step 1 and never starts by itself
     label     the accessible name, else kitLabels.stepper ("Step-through; use the arrow keys")
     class     the figure's classes, default "fig"; id as on any element
     onStep    (step, steps) => void, on the opening step and whenever the step or the count changes. A function, so only inside
               your own "use client" component: keep the step in state and draw from it (a Chart, a readout). A stepper with no
               data-step parts must redraw on it; check warns about one whose steps change only the captions.
   Inside your component, captions and parts may follow its state (a scenario switch): the stepper re-reads them after each render,
   so the step count follows. It stays on its step (clamped to the new count), or on the new last step if it was on the last.
   A stepper with fewer than 2 steps hides its controls and shows everything; they return when it grows.
   The controls: <button data-go="-1"> Back, <button data-go="1"> Next (check --do click:'[data-go="1"]' steps forward), Play,
   the scrubber. Focus the stepper (Tab or click inside) and use Left/Right/Home/End. Their texts are the labels back, play, pause,
   next, stepControls and step in the page's frontmatter labels. A Mermaid diagram does not step: show it whole and link its parts
   to the text. Under reduced motion there are no transitions; Play still advances because the reader asked for it. */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface StepperProps {
	children?: ComponentChildren;
	captions?: ComponentChildren[];
	captionsFirst?: boolean;
	start?: number;
	label?: string;
	class?: string;
	id?: string;
	onStep?: (step: number, steps: number) => void;
}

/** The detail of kit steps.js's stepchange event. */
interface StepChange {
	step: number;
	steps: number;
}

const isStepChange = (event: Event): event is CustomEvent<StepChange> =>
	event instanceof CustomEvent && typeof event.detail?.step === "number";

/**
 * Renders the markup kit steps.js steps through (`[data-stepper]`, the parts, `ol[data-captions]`); steps.js adds the controls
 * and owns the step. Not a client module, so the page can pass it static parts; inside a client component it also listens for
 * stepchange and asks steps.js to re-read after each render.
 */
export function Stepper({
	children,
	captions,
	captionsFirst = false,
	start,
	label,
	class: classes = "fig",
	id,
	onStep,
}: StepperProps) {
	const root = useRef<HTMLElement>(null);
	const latestOnStep = useRef(onStep);
	latestOnStep.current = onStep;
	// A layout effect runs as the island hydrates, before steps.js loads, so the listener hears the opening step it announces.
	useLayoutEffect(() => {
		const el = root.current;
		const heard = (event: Event) => {
			if (isStepChange(event) && event.target === el) {
				latestOnStep.current?.(event.detail.step, event.detail.steps);
			}
		};
		el?.addEventListener("stepchange", heard);
		return () => el?.removeEventListener("stepchange", heard);
	}, []);
	// After every render, before paint: re-read captions and parts and re-apply the step, since a re-rendered class attribute drops
	// steps.js's is-on and is-now. Refresh fires stepchange only when the step or count changed, so onStep's re-render ends here.
	// While the islands hydrate steps.js has not loaded yet; it finds the stepper itself when it does.
	useLayoutEffect(() => {
		if (root.current && typeof Steps !== "undefined") {
			Steps.refresh(root.current);
		}
	});
	// steps.js puts its controls just before this list, wherever it is.
	const list = captions && (
		<ol data-captions="">
			{captions.map((caption) => (
				<li>{caption}</li>
			))}
		</ol>
	);
	return (
		<figure
			ref={root}
			class={classes}
			id={id}
			data-stepper=""
			data-start={start}
			aria-label={label}
		>
			{captionsFirst && list}
			{children}
			{!captionsFirst && list}
		</figure>
	);
}
