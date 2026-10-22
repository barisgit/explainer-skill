import { join } from "node:path";

/** The installed skill directory (the parent of `src/`); everything the CLI reads at run time lives below it. */
export const SKILL_ROOT = join(import.meta.dir, "..");
/** What pages reference as `kit:<file>`. */
export const KIT_DIR = join(SKILL_ROOT, "kit");
