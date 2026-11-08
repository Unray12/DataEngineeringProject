/** Merge into the current address so consecutive changes cannot overwrite pending scope. */
export function scopeUrl(
  pathname: string,
  search: string,
  next: { farmId?: string; fieldId?: string },
): string {
  const params = new URLSearchParams(search);
  Object.entries(next).forEach(([key, value]) =>
    value ? params.set(key, value) : params.delete(key),
  );
  return `${pathname}${params.size ? `?${params}` : ""}`;
}
