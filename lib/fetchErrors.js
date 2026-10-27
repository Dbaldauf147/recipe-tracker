// User-facing message for a recipe page we couldn't fetch server-side.
// Replaces the bare "Upstream returned 403", which told the user nothing about
// what to do next.
export function blockedMessage(status) {
  if (status === 401 || status === 403 || status === 429) {
    return `This site blocks automatic imports (HTTP ${status}). Try importing from a screenshot or pasting the recipe text instead.`;
  }
  return `Could not load that page (${status ? `HTTP ${status}` : 'unreachable'}). Check the link, or import from a screenshot or pasted text instead.`;
}
