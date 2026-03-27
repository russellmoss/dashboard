/**
 * Fuzzy matching function for advisor names
 * Matches if:
 * - The query appears anywhere in the name (case-insensitive)
 * - Any word in the name starts with the query
 * - The name contains all characters of the query in order (fuzzy)
 */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query.trim()) return true;

  const normalizedQuery = query.toLowerCase().trim();
  const normalizedText = text.toLowerCase().trim();

  // Exact substring match
  if (normalizedText.includes(normalizedQuery)) {
    return true;
  }

  // Word boundary match - check if any word starts with the query
  const words = normalizedText.split(/\s+/);
  if (words.some(word => word.startsWith(normalizedQuery))) {
    return true;
  }

  // Fuzzy match: check if all characters of query appear in order in the text
  let queryIndex = 0;
  for (let i = 0; i < normalizedText.length && queryIndex < normalizedQuery.length; i++) {
    if (normalizedText[i] === normalizedQuery[queryIndex]) {
      queryIndex++;
    }
  }

  // If we matched all characters, it's a fuzzy match
  if (queryIndex === normalizedQuery.length) {
    return true;
  }

  // Check if query words appear in any order in the text
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
  if (queryWords.length > 1) {
    return queryWords.every(word =>
      normalizedText.includes(word) ||
      words.some(w => w.startsWith(word))
    );
  }

  return false;
}

/**
 * Extract first name from full name for sorting purposes
 *
 * @param fullName - Full name string (e.g., "John Doe" or "John Michael Doe")
 * @returns First name portion of the full name
 */
export function getFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || fullName;
}
