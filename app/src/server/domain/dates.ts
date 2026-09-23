const DAY = 86_400_000;
export function todayJST(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
}
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
export function weekStart(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}
export function nextMonth(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
export function midnightJST(day: string): string {
  return new Date(`${day}T00:00:00+09:00`).toISOString();
}
export function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
