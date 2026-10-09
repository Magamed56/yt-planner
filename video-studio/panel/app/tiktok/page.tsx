// Экран «TikTok»: подключение аккаунта (Login Kit) и статистика из Display API. Ролики
// сопоставляются с темами плана по названию в подписи.
import { headers } from "next/headers";
import { connection } from "next/server";
import ErrorScreen from "@/components/ErrorScreen";
import TikTokView, { type TikTokPageData } from "@/components/TikTokView";
import { loadState } from "@/lib/load";
import { redirectUri, TikTokError, tiktokEnvMissing, tiktokUser, tiktokVideos, tokens } from "@/lib/tiktok";
import { tiktokStats } from "@/lib/tiktok-data";

export const metadata = { title: "TikTok — Суть за минуту" };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default async function TikTokPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
  let state: Awaited<ReturnType<typeof loadState>>;
  try {
    state = await loadState();
  } catch (e) {
    return <ErrorScreen title="Не получилось загрузить TikTok" message={errorText(e)} />;
  }
  const data: TikTokPageData = {
    missing: tiktokEnvMissing(),
    redirectUri: redirectUri(origin),
    docsUrl: `https://github.com/${state.repo}/blob/${state.branch}/video-studio/docs/tiktok-setup.md`,
    status: "setup",
    error: (await searchParams).error ?? null,
    connectedLabel: null,
    stats: null,
  };
  if (!data.missing.length) {
    try {
      const t = await tokens();
      if (!t) data.status = "disconnected";
      else {
        data.status = "connected";
        data.connectedLabel = new Intl.DateTimeFormat("ru-RU", { timeZone: state.timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t.connectedAt));
        const [user, videos] = await Promise.all([tiktokUser(t), tiktokVideos(t)]);
        const topics = state.rows.map((r) => ({ code: r.code, titles: [r.title, r.youtube?.title ?? ""].filter(Boolean) }));
        data.stats = tiktokStats(user, videos, topics, new Date(), state.timezone);
      }
    } catch (e) {
      data.error = errorText(e);
      if (e instanceof TikTokError && e.reconnect) data.status = "disconnected";
      else if (data.status === "setup") data.status = "disconnected";
    }
  }
  return (
    <TikTokView
      data={data}
      shell={{ updated: state.updatedLabel, generatedAt: state.generatedAt, activeRuns: state.runs.filter((r) => r.active).length, runwayDays: state.runwayDays, runwayLabel: state.scheduleEndLabel }}
    />
  );
}
