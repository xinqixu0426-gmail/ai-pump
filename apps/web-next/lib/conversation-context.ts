// Reuse the persisted technical chat identity; never generate per-message/account IDs.
export function conversationTransportId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('CONVERSATION_ID_INVALID');
  return `chat-${id}`;
}
