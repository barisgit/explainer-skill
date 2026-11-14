/**
 * The states a Stepper or an Explore gives the page's parts by ref (kit link), as pack writes them. An Explore's figure declares
 * its starting frame's states in data-ref-states, a JSON map of ref to state ("" for none); a Stepper's captions name the refs
 * of their step in data-refs, which kit:steps.js turns into states only while it runs, so the file shows a stepper whole.
 * pack writes each declared state as data-state on the elements of its ref, as kit:link.js does in the browser (with its
 * data-kit-state marker, and now winning over not-yet), so the page reads without scripts and prints. A named ref that no
 * element carries is a problem naming the control and where it is. Refs count anywhere on the page: a filled View's records
 * are drawn into it one at a time, so a page control may name a ref a record draws, and a record's control one the page or that
 * record carries.
 */
import { unescapeHtml } from "./escape.ts";
import { followHeadings } from "./ids.ts";

/** A ref a control names, with the words that tell the author which control and how: `the Stepper under "Flow" names`, ` at step 3`. */
interface Naming {
	ref: string;
	by: string;
	at: string;
}

const words = (text: string | null) =>
	unescapeHtml(text ?? "")
		.split(/\s+/)
		.filter(Boolean);
const under = (heading: string | undefined, place: string) =>
	`${heading ? ` under "${heading}"` : ""}${place ? ` in ${place}` : ""}`;

/** A declaration's entries, or none for one that is not a JSON map (pack writes them, so that is not the author's to fix). */
function entries(json: string | null): [string, unknown][] {
	try {
		const map: unknown = JSON.parse(unescapeHtml(json ?? ""));
		return map !== null && typeof map === "object" ? Object.entries(map) : [];
	} catch {
		return [];
	}
}

/** A record a filled View drew at pack time, with the hash that opens it (`#item/a`) as its place. */
export interface PlacedRecord {
	place: string;
	record: string;
}

/**
 * What `html` declares: the refs its elements carry, the refs each control names (`place` is the record's hash, "" for the
 * page), and the states given to each ref.
 */
async function declarations(html: string, place = "") {
	const carried = new Set<string>();
	const named: Naming[] = [];
	const given = new Map<string, string[]>();
	const rewriter = new HTMLRewriter();
	const heading = followHeadings(rewriter);
	let step = 0;
	await rewriter
		.on("[data-ref]", {
			element(el) {
				for (const ref of words(el.getAttribute("data-ref"))) {
					carried.add(ref);
				}
			},
		})
		.on("[data-ref-states]", {
			element(el) {
				const by = `the Explore${under(heading(), place)} sets a state on`;
				for (const [ref, state] of entries(el.getAttribute("data-ref-states"))) {
					named.push({ ref, by, at: "" });
					const states = given.get(ref) ?? [];
					if (typeof state === "string" && state && !states.includes(state)) {
						states.push(state);
					}
					given.set(ref, states);
				}
			},
		})
		.on("[data-stepper] [data-captions]", {
			element() {
				step = 0;
			},
		})
		.on("[data-stepper] [data-captions] > li", {
			element(el) {
				step++;
				const by = `the Stepper${under(heading(), place)} names`;
				for (const ref of words(el.getAttribute("data-refs"))) {
					named.push({ ref, by, at: ` at step ${step}` });
				}
			},
		})
		.transform(new Response(html))
		.text();
	return { carried, named, given };
}

/** The joined state of refs given `states`, each once in page order; the kit's now wins over not-yet, as in kit:link.js. */
function joined(states: string[]): string {
	const set = new Set(states);
	if (set.has("now")) {
		set.delete("not-yet");
	}
	return [...set].join(" ");
}

/**
 * `html` with every declared state written as data-state on the elements of its ref, marked data-kit-state, as kit:link.js does:
 * an element whose refs are named with no state loses its data-state, and one no declaration names is left as it is.
 */
function writeStates(html: string, given: Map<string, string[]>): Promise<string> {
	return new HTMLRewriter()
		.on("[data-ref]", {
			element(el) {
				const refs = words(el.getAttribute("data-ref")).filter((ref) => given.has(ref));
				if (!refs.length) {
					return;
				}
				const state = joined(refs.flatMap((ref) => given.get(ref) ?? []));
				if (state) {
					el.setAttribute("data-state", state);
					el.setAttribute("data-kit-state", "");
				} else {
					el.removeAttribute("data-state");
					el.removeAttribute("data-kit-state");
				}
			},
		})
		.transform(new Response(html))
		.text();
}

const missing = ({ ref, by, at }: Naming) =>
	`${by} "${ref}"${at}, but no element has data-ref="${ref}": give the part that ref, or correct the name (a sequence diagram's messages are m1, m2, ... in order; kit mermaid)`;

/**
 * `html` with the starting states written in, one problem per control and ref it names that no element carries (on the page or
 * in `records`, the filled Views' records drawn at pack time), and every ref a page control names (such a ref needs no partner
 * to mean something, so it is no lone ref).
 */
export async function writeRefStates(
	html: string,
	records: PlacedRecord[] = [],
): Promise<{ html: string; problems: string[]; named: Set<string> }> {
	const page = await declarations(html);
	const drawn = await Promise.all(records.map(({ place, record }) => declarations(record, place)));
	const anyRecord = new Set(drawn.flatMap(({ carried }) => [...carried]));
	const problems = [
		...page.named.filter(({ ref }) => !page.carried.has(ref) && !anyRecord.has(ref)),
		...drawn.flatMap(({ carried, named }) =>
			named.filter(({ ref }) => !page.carried.has(ref) && !carried.has(ref)),
		),
	].map(missing);
	return {
		html: page.given.size ? await writeStates(html, page.given) : html,
		problems: [...new Set(problems)],
		named: new Set(page.named.map(({ ref }) => ref)),
	};
}
