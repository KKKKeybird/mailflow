// The email is case-insensitive; the decoded From display name is case-sensitive.
// A newline separates the two so names containing punctuation cannot collide.
export function senderIdentity(email, name = '') {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return '';
  const displayName = String(name || '').trim();
  return address + (displayName ? `\n${displayName}` : '');
}

export function splitSenderIdentity(identity) {
  const value = String(identity || '');
  const boundary = value.indexOf('\n');
  return boundary < 0 ? { email: value, name: '' }
    : { email: value.slice(0, boundary), name: value.slice(boundary + 1) };
}

export function normalizeSenderIdentity(value) {
  if (typeof value !== 'string') return null;
  const { email, name } = splitSenderIdentity(value);
  if (email.length > 320 || name.length > 1000 || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || /[\r\n\0]/.test(name)) return null;
  return senderIdentity(email, name);
}

export const senderIdentitySql = alias => `(lower(btrim(${alias}.from_email)) || CASE WHEN btrim(COALESCE(${alias}.from_name, '')) = '' THEN '' ELSE chr(10) || btrim(${alias}.from_name) END)`;
