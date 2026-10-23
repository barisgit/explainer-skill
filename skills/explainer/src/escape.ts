/** `</script` and `<!--` inside inline script would end or alter the element. */
export const safeScript = (js: string) =>
	js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
