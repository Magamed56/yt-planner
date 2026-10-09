"use client";
// Число на иконке приложения с экрана «Домой» (App Badging API: iOS 16.4+ при включённых
// уведомлениях, Chrome и Edge у установленного приложения). Где не умеют — молча ничего.
export function setBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    const done = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.();
    done?.catch(() => {});
  } catch {
    // без значка
  }
}
