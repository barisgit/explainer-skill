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

	let storage: Storage | undefined;
	const readChoice = () => {
		try {
			storage ??= localStorage;
			const saved = storage.getItem(key);
			if (saved === "system" || saved === "light" || saved === "dark") {
				return saved;
			}
		} catch {
			// A browser can refuse localStorage, including for local files.
		}
		return undefined;
	};

	// Read before styles render. The HTML attribute is also the default when scripting is off.
	const choice = readChoice() ?? root.dataset.scheme ?? "system";
	apply(choice);

	document.addEventListener("DOMContentLoaded", () => {
		const picker = document.createElement("select");
		picker.className = "scheme-picker";
		picker.dataset.keep = "off"; // An origin preference, not one of the page's kept answers or controls.
		picker.setAttribute("aria-label", text("theme"));
		picker.add(new Option(text("themeSystem"), "system"));
		picker.add(new Option(text("themeLight"), "light"));
		picker.add(new Option(text("themeDark"), "dark"));
		picker.value = choice;
		picker.addEventListener("change", () => {
			apply(picker.value);
			try {
				storage?.setItem(key, picker.value);
			} catch {
				// The applied choice does not depend on storage.
			}
		});
		addEventListener("storage", (event) => {
			if (event.storageArea === storage && event.key === key) {
				// Read the latest choice in case two tabs wrote before the event was delivered.
				const saved = readChoice();
				if (saved) {
					picker.value = saved;
					apply(saved);
				}
			}
		});
		const control = document.createElement("div");
		control.className = "scheme-control";
		control.append(picker);
		document.body.prepend(control);
	});
})();
