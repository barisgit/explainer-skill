/* Recall: a reminder opened under each <Term>, which can open a View instead.
   For a prerequisite the text leans on that a reader may half-know: hidden but one tap away, at every mention.
   <Recall id="spectrum">The **spectrum** $X(f)$ of a signal says how strong each frequency in it is.</Recall>
   ... multiplying shifts the <Term recall="spectrum">spectrum</Term> by $\pm f_0$ ...
     Recall id      the reminder's stable name, once per page; write it anywhere (the end of the page, say): it shows only at its mentions
     Term recall    the Recall it opens; its children are the words as the sentence has them ("spectra")
     Term open      starts open; a Term carries its state as aria-expanded, so a server can open the ones a reader needs
     Term view      in place of recall: the View the term leads to (kit View), "name" or "name/param", for a prerequisite
                    longer than a sentence or two. The term is a link; Back returns the reader to it, where they were
     Term data-ref  links the term as any data-ref does (kit link)
   A Term is a button in the sentence: a tap, Enter or Space opens the reminder right after it, inside the text, and closes it again.
   A reader who knows the term reads on without it. The reminder is one short paragraph (inline math and links are fine) and
   mentions no other Term. A printout shows it at the term's first mention and wherever it is open.
   pack fails on a Term whose Recall or View is missing, in a heading or a link, or in a "use client" component (pack places the
   text), and warns about a Recall no Term mentions. Not for what the page itself explains: that stays in the text. */
import { type ComponentChildren, h } from "preact";

/** The element pack takes a Recall's text from and removes (src/recalls.ts); it never reaches the page. */
const RECALL_MARKER = "explainer-recall";

export interface RecallProps {
	id: string;
	children: ComponentChildren;
}

interface TermCommon {
	"data-ref"?: string;
	children: ComponentChildren;
}

/** A Term that opens its Recall in place. */
export interface RecallTermProps extends TermCommon {
	recall: string;
	open?: boolean;
	view?: never;
}

/** A Term that leads to a View. */
export interface ViewTermProps extends TermCommon {
	view: string;
	recall?: never;
	open?: never;
}

export type TermProps = RecallTermProps | ViewTermProps;

/** The text of a reminder, inside the marker pack takes it from. */
export function Recall({ id, children }: RecallProps) {
	return h(RECALL_MARKER, { "data-id": id }, children);
}

/** A view's route as View writes its data-view: the param's ? # and % escaped, so the hash opens it (#name/a%3Fb). */
function viewRoute(view: string) {
	const slash = view.indexOf("/");
	return slash < 0
		? view
		: `${view.slice(0, slash)}/${view.slice(slash + 1).replace(/[%?#]/g, encodeURIComponent)}`;
}

/**
 * A mention: the button that opens its Recall, with the empty box pack fills with the Recall's text, or the link to its View,
 * which pack checks a View claims (src/recalls.ts).
 */
export function Term(props: TermProps) {
	const { recall, view, open = false, children, ...link } = props;
	if ((recall === undefined) === (view === undefined)) {
		throw new Error(
			`<Term> takes recall="..." (a reminder opened in place) or view="..." (a View it leads to), one of the two`,
		);
	}
	if (view !== undefined) {
		return (
			<a class="term" href={`#${viewRoute(view)}`} data-term-view={view} {...link}>
				{children}
			</a>
		);
	}
	return (
		<>
			<button
				type="button"
				class="term"
				data-recall={recall}
				{...link}
				aria-expanded={open ? "true" : "false"}
			>
				{children}
			</button>
			<span class="recall" data-recall-text={recall} />
		</>
	);
}
