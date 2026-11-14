/* Stepper: a step-through figure over data-step parts or refs, Mermaid's too: Back/Play/Next, a scrubber and arrow keys.
   <Stepper start={1} captions={["The queue is empty", "A burst arrives", "The backlog clears"]}>
     <svg viewBox="0 0 90 20"><rect data-step="1" width="20" height="20" /><rect data-step="2 3" x="35" width="20" height="20" /></svg>
   </Stepper>
     children  the parts, HTML or hand-built SVG. data-step="2 4" makes a part appear at step 2 and lit (is-now) on 2 and 4;
               "0 3" is visible from the start and lit at 3; a part without data-step never changes
     captions  one per step, text or JSX; the current one shows. The number of steps is the number of captions, else the highest step used
     refs      per step, the data-ref values it shows and lights, anywhere on the page: refs={["m1", "m2 call", "m3 call reply"]}.
               A ref is faded until the first step naming it and lit on each step that names it (data-state not-yet and now,
               kit link). So a Mermaid diagram steps: put it in the Stepper and name its parts (sequence messages m1, m2, ...; kit
               mermaid), and the code lines or cards that go with each step. Print shows every part
     captionsFirst  the captions (and the controls over them) before the parts, as text to read before the picture; default after
     start     the opening step. By default the stepper opens on the last step (the complete picture, same as print and without JS);
               study pages start at 1. Play restarts from step 1 and never starts by itself
     label     the accessible name, else kitLabels.stepper ("Step-through; use the arrow keys")
     class     the figure's classes, default "fig"; id as on any element
     onStep    (step, steps) => void, on the opening step and whenever the step or the count changes. A function, so only inside
               your own "use client" component: keep the step in state and draw from it (a Chart, a readout). A stepper with no
               data-step parts or refs must redraw on it; check warns about one whose steps change only the captions.
   Inside your component, captions and parts may follow its state (a scenario switch): the stepper re-reads them after each render,
   so the step count follows. It stays on its step (clamped to the new count), or on the new last step if it was on the last.
   To start new content from step 1 instead (another wave's derivation, a run on another map), name it: restartOn={wave}, text
   or a number; when it changes, the stepper goes back to step 1.
   A stepper with fewer than 2 steps hides its controls and shows everything; they return when it grows.
   The controls: <button data-go="-1"> Back, <button data-go="1"> Next (check --do click:'[data-go="1"]' steps forward), Play,
   the scrubber. Focus the stepper (Tab or click inside) and use Left/Right/Home/End. Their texts are the labels back, play, pause,
   next, stepControls and step in the page's frontmatter labels. Under reduced motion there are no transitions; Play still
   advances because the reader asked for it. */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface StepperProps {
	children?: ComponentChildren;
	captions?: ComponentChildren[];
	/** Per step, the refs it shows and lights, space separated; one entry per caption at most. */
	refs?: string[];
	captionsFirst?: boolean;
	start?: number;
	/**
	 * A key for the content: a new value sends the stepper back to step 1. Text or a number, so a fresh array is never new; undefined
	 * is no key, so a wrapper can pass its own optional one through.
	 */
	restartOn?: string | number | undefined;
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
	refs,
	captionsFirst = false,
	start,
	restartOn,
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
	// While the islands hydrate steps.js has not loaded yet; it finds the stepper itself when it does. A new restartOn goes to step 1.
	const shownFor = useRef(restartOn);
	useLayoutEffect(() => {
		const restart = shownFor.current !== restartOn;
		shownFor.current = restartOn;
		if (root.current && typeof Steps !== "undefined") {
			Steps.refresh(root.current, restart ? 1 : undefined);
		}
	});
	if (refs && refs.length > (captions?.length ?? 0)) {
		throw new Error(
			`<Stepper> refs names ${refs.length} steps but captions has ${captions?.length ?? 0}: give one caption per step`,
		);
	}
	// steps.js puts its controls just before this list, wherever it is.
	const list = captions && (
		<ol data-captions="">
			{captions.map((caption, i) => (
				<li data-refs={refs?.[i]?.trim() || undefined}>{caption}</li>
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
