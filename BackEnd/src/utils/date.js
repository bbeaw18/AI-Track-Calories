export function todayThailandISO() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const th = new Date(utc + 7 * 60 * 60 * 1000);
  const y = th.getFullYear();
  const m = String(th.getMonth() + 1).padStart(2, '0');
  const d = String(th.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
