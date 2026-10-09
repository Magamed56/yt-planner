"use client";
// Приложение с экрана «Домой» iOS держит спящим часами, а потом показывает старое — например,
// «в работе» у давно закончившегося запуска. Когда панель снова на экране и данным больше
// 5 минут, обновляемся сами. Чаще раза в минуту — нет: каждое обновление — запросы к GitHub
// и ~3–5 единиц квоты YouTube.
import { useEffect, useRef } from "react";

const STALE_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

export function useResumeRefresh(generatedAt: string | null, refresh: () => void, pending: boolean): void {
  const last = useRef(0);
  const live = useRef({ generatedAt, refresh, pending });
  useEffect(() => {
    live.current = { generatedAt, refresh, pending };
  });
  useEffect(() => {
    const check = () => {
      const { generatedAt: at, refresh: run, pending: busy } = live.current;
      if (document.visibilityState !== "visible" || busy || !at) return;
      const now = Date.now();
      if (now - Date.parse(at) < STALE_MS || now - last.current < MIN_GAP_MS) return;
      last.current = now;
      run();
    };
    // pageshow с persisted — страницу вернули из кэша «назад/вперёд» (Safari так делает с PWA).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) check();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
}
