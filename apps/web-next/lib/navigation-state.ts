export function buildCurrentHref(pathname: string, searchParams: Pick<URLSearchParams, 'toString'>) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function navigationHrefMatches(currentHref: string, targetHref: string) {
  const baseUrl = 'https://navigation.local';
  const current = new URL(currentHref, baseUrl);
  const target = new URL(targetHref, baseUrl);
  if (current.pathname !== target.pathname) return false;
  for (const [key, value] of target.searchParams) {
    const currentValues = current.searchParams.getAll(key);
    if (currentValues.length !== 1 || currentValues[0] !== value) return false;
  }
  return true;
}
