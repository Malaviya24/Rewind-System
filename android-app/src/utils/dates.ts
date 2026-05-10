export function todayIso() {
  return formatDateIso(new Date());
}

export function currentMonthIso() {
  return todayIso().slice(0, 7);
}

export function addMonthsIso(months: number, value = currentMonthIso()) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(value = currentMonthIso()) {
  const start = `${value}-01`;
  const end = `${addMonthsIso(1, value)}-01`;
  return { start, end };
}

export function nowIso() {
  return new Date().toISOString();
}

export function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateIso(date);
}

function formatDateIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function displayDate(value: string) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function displayMonth(value: string) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(`${value}-01`));
}

export function isOverdue(deadlineDate: string, status: string) {
  return !["Completed", "Delivered"].includes(status) && deadlineDate < todayIso();
}
