/** Lowercase + strip diacritics. The shared normalisation both sides of every
 *  text comparison must agree on. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Dedupe/trigram key for a product or brand name: normalizeText, then strip
 *  punctuation, then collapse whitespace. */
export function normalizeName(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ComposeSearchTextInput {
  name: string;
  brandName: string | null;
  subcategory: string | null;
  description: string;
  retailerNames: string[];
}

/** Builds food_drop.search_text. Fields are joined with a space and normalised
 *  as a whole. Order is name, brand, subcategory, description, retailers —
 *  currently unweighted; all fields count equally toward a match. */
export function composeSearchText(input: ComposeSearchTextInput): string {
  const parts = [
    input.name,
    input.brandName ?? '',
    input.subcategory ?? '',
    input.description,
    ...input.retailerNames,
  ];
  return normalizeText(parts.join(' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Turns a user's raw search box input into a `to_tsquery('english', …)`
 * string. Returns null when there is nothing searchable left after
 * sanitising.
 *
 * Stripping every non-alphanumeric character is the injection guard: no
 * tsquery metacharacter (`& | ! ( ) : *` or a quote) can survive into the
 * query string. Parameterisation alone doesn't protect against this, because
 * the tsquery string is itself a mini-language Postgres parses.
 *
 * `:*` is appended to the LAST token only, so `pick` still finds "Pickle
 * Lemonade" (search-as-you-type) without making every token a prefix match —
 * which would make `taco bell` match unrelated words sharing a prefix.
 */
export function buildTsQuery(search: string): string | null {
  const tokens = normalizeText(search)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;

  const lastIndex = tokens.length - 1;
  return tokens.map((token, i) => (i === lastIndex ? `${token}:*` : token)).join(' & ');
}
