export function filterEditableOptions<T extends { value: string; label: string }>(options: T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter(option => {
    const text = `${option.value} ${option.label}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}

export function moveActiveOptionIndex({
  currentIndex,
  optionCount,
  selectedIndex,
  direction,
}: {
  currentIndex: number;
  optionCount: number;
  selectedIndex: number;
  direction: 'next' | 'previous';
}) {
  if (optionCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= optionCount) {
    if (selectedIndex >= 0 && selectedIndex < optionCount) return selectedIndex;
    return direction === 'next' ? 0 : optionCount - 1;
  }
  if (direction === 'next') return (currentIndex + 1) % optionCount;
  return (currentIndex - 1 + optionCount) % optionCount;
}
