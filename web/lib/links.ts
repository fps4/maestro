// Webapp route builders. The read API returns its *own* paths in `href`; the workspace renders at
// different routes, so links are built here, never copied from the API response.

export function specsPath(productId: string): string {
  return `/products/${encodeURIComponent(productId)}/specs`;
}

export function specPath(productId: string, feature: string, kind: string, branch?: string): string {
  const base = `${specsPath(productId)}/${encodeURIComponent(feature)}/${encodeURIComponent(kind)}`;
  return branch ? `${base}?branch=${encodeURIComponent(branch)}` : base;
}
