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
