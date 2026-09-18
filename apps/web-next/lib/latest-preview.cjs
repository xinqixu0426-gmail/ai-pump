function createLatestPreviewCoordinator() {
  const activeTokens = new Map()

  return {
    clear(key) {
      if (key === undefined) activeTokens.clear()
      else activeTokens.delete(key)
    },

    async run(key, preview, handlers) {
      const token = Symbol('latest-preview')
      activeTokens.set(key, token)
      try {
        const result = await preview()
        if (activeTokens.get(key) !== token) return false
        handlers.onSuccess(result)
      } catch (error) {
        if (activeTokens.get(key) !== token) return false
        handlers.onError(error)
      } finally {
        if (activeTokens.get(key) === token) handlers.onSettled?.()
      }
      return true
    },
  }
}

module.exports = { createLatestPreviewCoordinator }
