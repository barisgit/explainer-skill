import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A form whose fields log every input and change event as "<id> <type> <value>" in `heard`, the way a page reacting to them would. */
const FORM = (checks: Record<string, string>) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Form</h1>
<input id="q" value="old"><input id="note" name="note"><textarea id="t">draft</textarea>
<input id="a[1]"><input data-label="a]=b">
<input id="r" type="range" min="0" max="10" value="2">
<select id="s"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>
<script>
var heard = [];
for (const el of document.querySelectorAll("input, select, textarea")) {
	for (const type of ["input", "change"]) el.addEventListener(type, () => heard.push(el.id + " " + type + " " + el.value));
}
const of = (id) => heard.filter((h) => h.startsWith(id + " "));
${pageContract(checks)}
</script></body></html>`;

test("check --do type: types over a field key by key, then leaves it, so input listeners see each key and change fires", async () => {
	const page = FORM({
		"the typed text replaces the old value": 'document.getElementById("q").value === "heat pump"',
		"an input event per key, the last with the whole text":
			'of("q").filter((h) => h.includes(" input ")).length === 9 && of("q").includes("q input heat pump")',
		"change fires once, after the text is in": 'of("q").at(-1) === "q change heat pump"',
		"a quoted ]= inside an attribute value stays in the selector":
			'document.querySelector("[data-label]").value === "new"',
		"escaped brackets stay in the selector": 'document.getElementById("a[1]").value === "x=y"',
		"a selector with = in it and a text with = in it split at the first = outside brackets":
			'document.getElementById("note").value === "a=b"',
		"type: with no text clears a textarea": 'document.getElementById("t").value === ""',
	});

	const failures = await packAndRun(dir, "type", page, {
		steps: [
			"type:#q=heat pump",
			"type:input[name=note]=a=b",
			"type:#t=",
			'type:input[data-label="a]=b"]=new',
			"type:#a\\[1\\]=x=y",
		],
	});

	expect(failures).toEqual([]);
}, 60_000);

test("check --do set: moves a range and chooses a select option, firing input then change", async () => {
	const page = FORM({
		"the range holds the value and its listeners heard it":
			'document.getElementById("r").value === "7" && of("r").join() === "r input 7,r change 7"',
		"the select holds the option and its listeners heard it":
			'document.getElementById("s").value === "c" && of("s").join() === "s input c,s change c"',
	});

	expect(await packAndRun(dir, "set", page, { steps: ["set:#r=7", "set:#s=c"] })).toEqual([]);
}, 60_000);

test("check --do set: to a value the field cannot hold is a problem naming what it holds", async () => {
	const failures = await packAndRun(dir, "set-bad", FORM({}), { steps: ["set:#s=z", "set:#r=99"] });

	expect(failures).toEqual([
		'1440: set:#s=z: no option has the value "z" (a, b, c)',
		'1440: set:#r=99: the field holds "10", not "99"',
		'390: set:#s=z: no option has the value "z" (a, b, c)',
		'390: set:#r=99: the field holds "10", not "99"',
	]);
}, 60_000);

test("check --do key: types a punctuation character, which shares its code point with another key's code (. is Delete)", async () => {
	const page = FORM({
		"3.5% typed one key at a time": 'document.getElementById("q").value === "old3.5%"',
	});
	const keys = ["3", ".", "5", "%"].map((key) => `key:${key}`);

	const failures = await packAndRun(dir, "key-chars", page, {
		steps: ["focus:#q", "key:End", ...keys],
	});

	expect(failures).toEqual([]);
}, 60_000);

test("check --do type: or set: without =<value> is a usage error that shows the form", async () => {
	const file = dir.write("no-value.html", FORM({}));

	const result = await runCli(["check", file, "--quick", "--do", "set:#r"]);

	expect(result.code).toBe(2);
	expect(result.stderr).toContain("set:<css>=<value>");
}, 30_000);
