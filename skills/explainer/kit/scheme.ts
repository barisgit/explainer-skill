/* scheme: restores the reader's colour scheme before the stylesheet, then adds the native picker. */
(() => {
	const LABELS = {
		theme: "Theme",
		themeSystem: "System",
		themeLight: "Light",
		themeDark: "Dark",
	};
	const text = (key: keyof typeof LABELS) => window.kitLabels?.[key] || LABELS[key];
	const key = "explainer-scheme";
	const root = document.documentElement;
	const apply = (choice: string) => {
		if (choice === "system") {
			delete root.dataset.scheme;
		} else {
			root.dataset.scheme = choice;
		}
	};

	// Read once, before styles render. The HTML attribute is also the default when scripting is off.
	let choice = root.dataset.scheme ?? "system";
	try {
		const saved = localStorage.getItem(key);
		if (saved === "system" || saved === "light" || saved === "dark") {
			choice = saved;
			apply(choice);
		}
	} catch {
		// A browser can refuse localStorage, including for local files. The control still works for this visit.
	}

	document.addEventListener("DOMContentLoaded", () => {
		const picker = document.createElement("select");
		picker.className = "scheme-picker";
		picker.setAttribute("aria-label", text("theme"));
		picker.add(new Option(text("themeSystem"), "system"));
		picker.add(new Option(text("themeLight"), "light"));
		picker.add(new Option(text("themeDark"), "dark"));
		picker.value = choice;
		picker.addEventListener("change", () => {
			apply(picker.value);
			try {
				localStorage.setItem(key, picker.value);
			} catch {
				// The applied choice does not depend on storage.
			}
		});
		document.body.prepend(picker);
	});
})();
