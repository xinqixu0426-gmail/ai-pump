export function restoreRejectedDraft(submittedDraft: string, currentDraft: string) {
  const normalizedSubmittedDraft = submittedDraft.trimEnd();
  if (!normalizedSubmittedDraft) return currentDraft;
  return currentDraft.trim()
    ? `${normalizedSubmittedDraft}\n${currentDraft}`
    : submittedDraft;
}
