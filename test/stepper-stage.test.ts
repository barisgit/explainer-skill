import { afterAll, expect, test } from "bun:test";
import { inPage, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const flow =
	"```mermaid\nflowchart LR\n  a[Commit] --> b[Capture the state] --> c[Upload it] --> d[Restore it]\n```";

test("a Stepper's diagram is at least the text's width on desktop, a plain one keeps its own", async () => {
	const output = await packedMdx(
		dir,
		"stage",
		`import { Stepper } from "kit"

# Walkthrough

## Steps

A short paragraph long enough to set the width of the text column on a desktop screen, which the staged drawing should match.

<Stepper captions={["One", "Two"]}>

${flow}

</Stepper>

## Plain

${flow}
`,
	);
	const seen = await inPage(output, (cdp) =>
		cdp.evaluate<{ text: number; staged: number; plain: number }>(`(() => {
			const width = (el) => el.getBoundingClientRect().width;
			const [staged, plain] = [...document.querySelectorAll("section .mermaid > svg:not([data-phone])")].map(width);
			return { text: width(document.querySelector("section > p")), staged, plain };
		})()`),
	);
	expect(seen.staged).toBeGreaterThanOrEqual(seen.text - 1);
	expect(seen.plain).toBeLessThan(seen.text);
});
