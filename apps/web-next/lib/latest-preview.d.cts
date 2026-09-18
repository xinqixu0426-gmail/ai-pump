export interface LatestPreviewHandlers<Result> {
  onSuccess: (result: Result) => void
  onError: (error: unknown) => void
  onSettled?: () => void
}

export interface LatestPreviewCoordinator<Key> {
  clear: (key?: Key) => void
  run: <Result>(
    key: Key,
    preview: () => Promise<Result>,
    handlers: LatestPreviewHandlers<Result>,
  ) => Promise<boolean>
}

export function createLatestPreviewCoordinator<Key>(): LatestPreviewCoordinator<Key>
