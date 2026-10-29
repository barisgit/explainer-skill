/** `</script` and `<!--` inside inline script would end or alter the element. */
export const safeScript = (js: string) =>
	js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** Text HTMLRewriter hands over as written, with the entities Preact and the MDX compiler write decoded (`&amp;` last). */
export const unescapeHtml = (text: string) =>
	text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");

/** Text or an attribute value as HTML source: the inverse of unescapeHtml. */
export const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
