/*
 * Imported by both island runtimes (server.ts and client.ts) for its effect: a bare `data-*` attribute in JSX
 * (`<fieldset data-reply>`, wherever the JSX is written) is `true`, which Preact would write as "true"; here it becomes empty,
 * as in HTML, so reply.js labels a question by its legend. The prerendered HTML and the DOM Preact makes in the browser agree,
 * so hydration finds nothing to change.
 */
import { options } from "preact";

const previousVnode = options.vnode;
options.vnode = (vnode) => {
	if (typeof vnode.type === "string") {
		// An element's props are the object the JSX call made for this vnode, so changing them in place is safe.
		const props = vnode.props as Record<string, unknown>;
		for (const key of Object.keys(props)) {
			if (key.startsWith("data-") && props[key] === true) {
				props[key] = "";
			}
		}
	}
	previousVnode?.(vnode);
};
