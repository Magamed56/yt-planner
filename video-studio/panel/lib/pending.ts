"use client";
// «В очереди…» сразу после нажатия: GitHub показывает новый запуск через 5–20 секунд, а кнопка
// не должна казаться неработающей (второе нажатие — второй платный запуск). Коды живут
// 3 минуты в sessionStorage этой вкладки; где хранилища нет — просто без отметки.
import { useSyncExternalStore } from "react";

const KEY = "sut.pending";
const TTL_MS = 3 * 60_000;
const EVENT = "sut-pending";

function read(): Record<string, number> {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter((e): e is [string, number] => typeof e[1] === "number" && now - e[1] < TTL_MS));
  } catch {
    return {};
  }
}

export function markPending(codes: string[]): void {
  try {
    const now = Date.now();
    sessionStorage.setItem(KEY, JSON.stringify({ ...read(), ...Object.fromEntries(codes.map((c) => [c, now])) }));
  } catch {
    // без отметки
  }
  window.dispatchEvent(new Event(EVENT));
}

// Запуск появился в GitHub — отметка больше не нужна.
export function clearPending(codes: string[]): void {
  const all = read();
  if (!codes.some((c) => c in all)) return;
  for (const c of codes) delete all[c];
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ничего
  }
  window.dispatchEvent(new Event(EVENT));
}

// Результат действия сервера: если запуск ушёл — отметить его ролики.
export function notePending(r: unknown): void {
  const d = (r as { ok?: boolean; dispatched?: { codes?: unknown } } | null)?.dispatched;
  if ((r as { ok?: boolean }).ok && Array.isArray(d?.codes)) markPending(d.codes.filter((c): c is string => typeof c === "string"));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  // Отметки истекают сами — раз в 15 с перечитываем.
  const timer = setInterval(onChange, 15_000);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
    clearInterval(timer);
  };
}

const snapshot = () => Object.keys(read()).sort().join(",");

// Коды «в очереди» (на сервере и до загрузки страницы — пусто: разметка совпадает).
export function usePending(): Set<string> {
  const s = useSyncExternalStore(subscribe, snapshot, () => "");
  return new Set(s ? s.split(",") : []);
}
