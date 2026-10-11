// Демо «Доски» на фикстуре (lib/board-fixture.ts, её же проверяет scripts/board-test.ts) —
// посмотреть вид глазами без GitHub и YouTube. Только в разработке (npm run dev): в сборке
// для Vercel страница отвечает 404. ?yt=0 — как будто YouTube не ответил.
import { notFound } from "next/navigation";
import BoardCanvas from "@/components/BoardCanvas";
import { boardData } from "@/lib/board";
import { boardFixture } from "@/lib/board-fixture";
import { langVideosOf } from "@/lib/lang-videos";

export default async function BoardDemoPage({ searchParams }: { searchParams: Promise<{ v?: string; yt?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { v, yt } = await searchParams;
  const fx = boardFixture(yt === "0" ? { youtubeError: "демо: YouTube не ответил" } : {});
  const data = boardData({
    now: fx.now,
    state: fx.state,
    enName: "Gist in a Minute",
    enJson: fx.enJson,
    enVideos: langVideosOf(fx.releases, "en"),
    enMarks: fx.enMarks,
    boardMarks: fx.boardMarks,
  });
  return <BoardCanvas data={data} initialSelected={typeof v === "string" ? v : null} />;
}
