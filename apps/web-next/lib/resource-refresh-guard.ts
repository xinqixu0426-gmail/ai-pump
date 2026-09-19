// Background catalog reads must not change the inputs of an open editor.
export function createResourceRefreshGuard(isEditing: () => boolean) {
  let version = 0;
  return {
    begin(background: boolean) {
      if (background && isEditing()) return null;
      return { version: ++version, background };
    },
    isLatest(request: { version: number }) {
      return request.version === version;
    },
    canApply(request: { version: number; background: boolean }) {
      return request.version === version && !(request.background && isEditing());
    },
    invalidate() { version += 1; },
  };
}
