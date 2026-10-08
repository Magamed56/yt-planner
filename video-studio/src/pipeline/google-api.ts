// Общее для запросов к YouTube Data API без пакета googleapis: access token и понятные
// причины отказов. Без зависимостей — этот модуль (через youtube-fill.ts) импортирует и
// веб-панель (panel/), где googleapis не установлен.

// Достаточно метода getAccessToken: подходит OAuth2Client из googleapis (CLI) и простой
// обмен refresh token → access token через fetch (панель).
export interface Auth {
  getAccessToken(): Promise<{ token?: string | null }>;
}

export async function accessToken(auth: Auth): Promise<string> {
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error("пустой access token");
    return token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_grant/i.test(msg)) {
      throw new Error(
        "YouTube: YT_REFRESH_TOKEN недействителен (отозван или истёк — у приложения в статусе «Testing» токен живёт 7 дней). " +
          "Переведите OAuth-приложение в «In production» и получите новый токен: npm run youtube-auth.",
      );
    }
    if (/invalid_client|unauthorized_client/i.test(msg)) {
      throw new Error("YouTube: неверные YT_CLIENT_ID / YT_CLIENT_SECRET (или токен выпущен для другого клиента). Проверьте .env / секреты GitHub.");
    }
    throw new Error(`YouTube: не удалось получить доступ (${msg}).`);
  }
}

// Понятные причины частых отказов API.
export function explainApiError(status: number, body: string): string {
  let reason = "";
  let message = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? "";
    message = j.error?.message ?? message;
  } catch {
    // не JSON — оставляем как есть
  }
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return "исчерпана суточная квота YouTube Data API (сбрасывается в полночь по тихоокеанскому времени).";
  if (reason === "uploadLimitExceeded") return "достигнут лимит загрузок канала на сегодня.";
  if (reason === "youtubeSignupRequired") return "у аккаунта Google нет канала YouTube — создайте канал.";
  if (reason === "invalidTitle") return "YouTube отклонил заголовок (пустой, длиннее 100 символов или с «<», «>»).";
  if (reason === "invalidDescription") return "YouTube отклонил описание (больше 5000 байт — у кириллицы 2 байта на букву — или с «<», «>»).";
  if (reason === "invalidTags") return "YouTube отклонил теги (суммарно больше 500 символов).";
  if (reason === "invalidPublishAt") return "YouTube отклонил время публикации (оно в прошлом или в неверном формате) — выберите слот позже: --schedule или --publish-at <ISO-время>.";
  if (reason === "insufficientPermissions" || (status === 403 && /insufficient|scope/i.test(message)))
    return "у токена не хватает прав (нужны youtube.upload и youtube) — получите YT_REFRESH_TOKEN заново: npm run youtube-auth или OAuth Playground (docs/youtube-setup.md).";
  if (reason === "forbidden") return `YouTube запретил действие (видео с другого канала? токен выпущен для другого аккаунта?): ${message}`;
  return `HTTP ${status}${reason ? ` ${reason}` : ""}: ${message}`;
}
