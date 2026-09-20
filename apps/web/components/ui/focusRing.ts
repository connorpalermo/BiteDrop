/**
 * Shared focus-visible ring for every interactive element. Spread this into a
 * primitive's class list rather than retyping the classes, so focus behaviour
 * stays identical everywhere and a theme change only has one place to update.
 * ring-focus and ring-offset-bg resolve through the --color-focus / --color-bg
 * theme tokens (globals.css @theme block) — not arbitrary values.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
