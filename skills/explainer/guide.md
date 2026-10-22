# What made pages better or worse

Each point comes from comparing generated pages side by side. Use judgment where your subject differs.

- **First screen:** the answer in one sentence and the figure that shows it. Pages that put every filter, summary number, and caveat up front read as a wall; controls for later questions belong in those sections.
- **Interaction that reveals:** each control answers a question the reader would ask and changes something visible at once. The ones readers valued: hiding the dominant part so the rest becomes readable, playing through several scenarios rather than one path, presets that can honestly end in "nothing fits", clicking a mark or row to open its own view.
- **Explanations:** offer several playable cases. Each step shows where we are, what just changed, and what has accumulated so far. One narrow walkthrough lost to broader pages every time.
- **Study material:** a page that took a course's slides and added every widget it could lost the point. Start from the questions the reader must answer and the source's own figures; give each idea at most one interaction, where moving it builds intuition; put answers behind a click so the reader tries first; end with a formula sheet. Include `kit:reply.js` so the reader's inputs and notes survive a reload; give inputs ids. Fidelity to the source beats extra scope.
- **Live text:** a headline or count that depends on controls updates with them, or is phrased as a claim about the default view. Labels and explanations never contradict the current state.
- **Charts:** use the zoom, legend toggles, animated switching between views, and click-to-drill that ECharts already has. Give exact values without hover, through a readout or a table behind a disclosure.
- **Diagrams:** Mermaid for structure, flows, sequences, and states; top-down layouts stay readable on phones. Step through a process instead of showing it only finished, and let the key terms in the prose light their part of the diagram. Keep node labels to a few words and let the step caption carry the sentence; long labels make tall boxes. Hand-build SVG only when a diagram must respond in ways stepping and highlighting cannot. An SVG file in `<img>` follows the theme through `currentColor` and the kit variables (`var(--ink)`, `var(--accent)`); write the SVG inline when its parts must be linked or interactive.
- **Asking the reader:** when the page ends in a choice only the reader can make, ask it on the page as a reply question rather than in chat text.
- **Phones:** stack and reflow. Nothing scrolls sideways except data tables.
- **Honesty:** unknown is not no; mark inferred claims as inferred; a claim never exceeds its source, especially about security.
- **Colour:** use the theme tokens so light and dark both work.
