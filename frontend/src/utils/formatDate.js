import { format, isToday, isYesterday, isThisYear } from 'date-fns';

export function formatMailTime(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  // Use zero for midnight, while keeping noon as 12 PM.
  return `${d.getHours() === 0 ? 0 : (d.getHours() % 12 || 12)}:${format(d, 'mm a')}`;
}

export function formatMessageDate(dateStr, mobile = false) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '';
  return `${format(d, mobile ? 'MMM d' : 'MMM d, yyyy')}, ${formatMailTime(d)}`;
}

// Compact relative date label shared by MessageList and the GTD display surfaces.
// Guards an invalid date to '' so a malformed value can never throw from
// date-fns format().
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '';
  if (isToday(d)) return formatMailTime(d);
  if (isYesterday(d)) return 'Yesterday';
  if (isThisYear(d)) return format(d, 'MMM d');
  return format(d, 'MMM d, yyyy');
}
