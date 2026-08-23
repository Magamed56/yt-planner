// Планировщик автопубликации. Запускается ОТДЕЛЬНО от `npm run dev`/`start`
// (в соседнем терминале) и раз в минуту проверяет, не пора ли какому-нибудь
// видео на этапе "Готово к публикации" уйти на YouTube — если план публикации
// уже наступил, файл указан и оно ещё не загружено, шлёт запрос на тот же
// /api/videos/[id]/upload-youtube, которым пользуется кнопка в интерфейсе.
//
// Запуск: node scripts/scheduler.js
// (сервер `npm run dev`/`npm run start` должен быть уже запущен — планировщик
// сам ничего не поднимает, только дёргает его API).

const BASE = process.env.SCHEDULER_BASE_URL || "http://localhost:3000";
const INTERVAL_MS = 60_000;

async function tick() {
  const now = new Date().toLocaleString("ru-RU");
  try {
    const res = await fetch(`${BASE}/api/videos/due`);
    if (!res.ok) {
      console.log(`[${now}] не удалось получить список видео (${res.status})`);
      return;
    }
    const due = await res.json();
    if (due.length === 0) {
      console.log(`[${now}] нечего публиковать`);
      return;
    }
    for (const video of due) {
      console.log(`[${now}] публикую «${video.title}» (план: ${video.plannedPublishAt})…`);
      const uploadRes = await fetch(`${BASE}/api/videos/${video.id}/upload-youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (uploadRes.ok) {
        console.log(`[${now}] ✓ «${video.title}» опубликовано`);
      } else {
        const body = await uploadRes.json().catch(() => ({}));
        console.log(`[${now}] ✗ «${video.title}» не удалось опубликовать: ${body.error ?? uploadRes.status}`);
      }
    }
  } catch (e) {
    console.log(`[${now}] ошибка планировщика:`, e instanceof Error ? e.message : e);
  }
}

console.log(`Планировщик запущен, проверка каждую минуту (${BASE})`);
tick();
setInterval(tick, INTERVAL_MS);
