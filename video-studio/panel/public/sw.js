// Сервис-воркер панели: только уведомления (push → показать, нажатие → открыть панель).
// Без кэша и перехвата запросов: панель всегда берёт свежие данные с сервера.
// Регистрирует его карточка «Уведомления на телефон», когда их включают.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const text = (v) => (typeof v === "string" ? v : "");
  const options = {
    body: text(data.body),
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url: text(data.url) || "/" },
  };
  if (text(data.tag)) options.tag = data.tag;
  // Показываем всегда, даже если сообщение не разобрали: iPhone отзывает подписку,
  // если push пришёл, а уведомления не было.
  event.waitUntil(self.registration.showNotification(text(data.title) || "Панель канала", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(raw, self.location.origin);
  event.waitUntil(
    (async () => {
      // Чужой сайт (лог GitHub) — новым окном, панель не уводим.
      if (target.origin !== self.location.origin) return self.clients.openWindow(target.href);
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((w) => w.url === target.href);
      if (same) return same.focus();
      // Панель уже открыта — переводим её на нужную страницу, а не плодим окна.
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin || !("navigate" in w)) continue;
        try {
          const moved = await w.navigate(target.href);
          if (moved) return moved.focus();
        } catch {
          // окно не под этим воркером — откроем новое
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
