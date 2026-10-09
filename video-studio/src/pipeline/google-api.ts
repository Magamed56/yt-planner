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

// Тело отказа Google API. Data API кладёт причину в errors[].reason, новые API (Analytics) — ещё и
// в details[] (ErrorInfo: ACCESS_TOKEN_SCOPE_INSUFFICIENT, SERVICE_DISABLED со ссылкой включения).
export interface ApiErrorInfo {
  reason: string; // первая причина из errors[]
  reasons: string[]; // все причины: errors[] и details[]
  message: string;
  activationUrl: string | null; // API выключен в проекте Google Cloud — ссылка, где включить
}

export function apiErrorInfo(body: string): ApiErrorInfo {
  const info: ApiErrorInfo = { reason: "", reasons: [], message: body.slice(0, 300), activationUrl: null };
  try {
    type Detail = { reason?: string; metadata?: { activationUrl?: string } };
    const j = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[]; details?: Detail[] } };
    const errors = Array.isArray(j.error?.errors) ? j.error.errors : [];
    const details = Array.isArray(j.error?.details) ? j.error.details : [];
    info.reason = errors[0]?.reason ?? "";
    info.reasons = [...errors.map((e) => e?.reason), ...details.map((d) => d?.reason)].filter((r): r is string => typeof r === "string" && r !== "");
    info.message = typeof j.error?.message === "string" ? j.error.message : info.message;
    const url = details.map((d) => d?.metadata?.activationUrl).find((u) => typeof u === "string" && /^https:\/\//.test(u));
    info.activationUrl = url ?? /https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s"]+/.exec(info.message)?.[0] ?? null;
  } catch {
    // не JSON — оставляем как есть
  }
  return info;
}

// У токена нет нужного права (scope) — лечится только новым YT_REFRESH_TOKEN.
export function isScopeError(status: number, body: string): boolean {
  if (status !== 403) return false;
  const { reasons, message } = apiErrorInfo(body);
  return reasons.includes("insufficientPermissions") || reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient authentication scopes/i.test(message);
}

// API не включён в проекте Google Cloud — лечится одной кнопкой Enable, ключ менять не нужно.
export function isApiDisabled(status: number, body: string): boolean {
  if (status !== 403) return false;
  const { reasons, message } = apiErrorInfo(body);
  return reasons.includes("accessNotConfigured") || reasons.includes("SERVICE_DISABLED") || /has not been used in project/i.test(message);
}

// Понятные причины частых отказов API.
export function explainApiError(status: number, body: string): string {
  const { reason, message, activationUrl } = apiErrorInfo(body);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return "исчерпана суточная квота YouTube Data API (сбрасывается в полночь по тихоокеанскому времени).";
  if (isApiDisabled(status, body))
    return `API не включён в проекте Google Cloud — включите его (APIs & Services → Library → Enable)${activationUrl ? `: ${activationUrl}` : ""}, через пару минут заработает.`;
  if (reason === "commentsDisabled") return "у ролика выключены комментарии (или он отмечен «для детей») — включите комментарии в Studio.";
  if (reason === "uploadLimitExceeded") return "достигнут лимит загрузок канала на сегодня.";
  if (reason === "youtubeSignupRequired") return "у аккаунта Google нет канала YouTube — создайте канал.";
  if (reason === "invalidTitle") return "YouTube отклонил заголовок (пустой, длиннее 100 символов или с «<», «>»).";
  if (reason === "invalidDescription") return "YouTube отклонил описание (больше 5000 байт — у кириллицы 2 байта на букву — или с «<», «>»).";
  if (reason === "invalidTags") return "YouTube отклонил теги (суммарно больше 500 символов).";
  if (reason === "invalidPublishAt") return "YouTube отклонил время публикации (оно в прошлом или в неверном формате) — выберите слот позже: --schedule или --publish-at <ISO-время>.";
  if (reason === "insufficientPermissions" || isScopeError(status, body) || (status === 403 && /insufficient|scope/i.test(message)))
    return "у токена не хватает прав (нужны youtube.upload и youtube, для субтитров и комментариев — youtube.force-ssl, для удержания — yt-analytics.readonly) — получите YT_REFRESH_TOKEN заново: npm run youtube-auth или OAuth Playground (docs/youtube-setup.md).";
  if (reason === "forbidden") return `YouTube запретил действие (видео с другого канала? токен выпущен для другого аккаунта?): ${message}`;
  return `HTTP ${status}${reason ? ` ${reason}` : ""}: ${message}`;
}
