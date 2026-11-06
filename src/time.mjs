// lib/schema/time.mjs
// Entry timestamp format: `YYYY-MM-DD ddd HH:mm` (e.g. 2026-05-19 Tue 21:04). This is
// the canonical entry timestamp — kept in this format (NOT ISO) for round-trip
// parity with plain-text logs, and it sorts chronologically as plain text. Pure + Node-testable.
export function formatTimestamp(d = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${day} ${hh}:${min}`;
}
