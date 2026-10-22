// A spam/ham move is hidden during the Undo window and the IMAP request.
// Scope the guard to the source folder: the destination must remain visible.
const moves = new Map();
const key = message => `${message.account_id}:${message.folder}:${message.id}`;
const prune = () => {
  for (const [id, expires] of moves) if (expires !== null && expires <= Date.now()) moves.delete(id);
};
export function setPendingSpamMove(message) { prune(); moves.set(key(message), null); }
export function completeSpamMove(message) { moves.set(key(message), Date.now() + 10000); }
export function clearSpamMove(message) { moves.delete(key(message)); }
export function applySpamMoveGuard(messages) {
  prune();
  return messages.filter(message => !moves.has(key(message)));
}
