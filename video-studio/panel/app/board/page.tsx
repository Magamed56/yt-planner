// «Доска» — полотно с четырьмя зонами (YouTube «Суть за минуту», YouTube на английском,
// Instagram, TikTok): карточки роликов со статусом и запас расписания над каждой зоной.
// Данные — те же, что у очереди и страницы English: GitHub и YouTube (≈ 3 единицы квоты), плюс
// переменные с отметками. Статусы и раскладка — lib/board.ts, полотно — components/BoardCanvas.tsx.
import type { Metadata } from "next";
import { connection } from "next/server";
import BoardCanvas, { type BoardData } from "@/components/BoardCanvas";
import ErrorScreen from "@/components/ErrorScreen";
import { BOARD_VAR, buildBoard, layoutBoard, parseBoardMarks } from "@/lib/board";
import { getVariable, listReleases } from "@/lib/github";
import { langChannel, langChannelJson } from "@/lib/lang-channels";
import { parseStudioMarks, STUDIO_MARKS_VAR } from "@/lib/lang-plan";
import { langVideosOf } from "@/lib/lang-videos";
import { loadState } from "@/lib/load";

export const metadata: Metadata = { title: "Доска — панель" };

// Переменная не прочиталась (сбой GitHub) — null: доска всё равно открывается, а кнопки, которые
// могли бы затереть отметки, прячутся.
const variable = (name: string) =>
  getVariable(name).then(
    (raw) => ({ raw }),
    () => null,
  );

export default async function BoardPage() {
  await connection(); // всегда свежие данные GitHub и YouTube
  const now = new Date();
  let data: BoardData;
  try {
    // Релизы — одним проходом: и для русской очереди, и для английских роликов.
    const releases = listReleases();
    releases.catch(() => {}); // ошибку покажет loadState
    const [state, studioRaw, boardRaw] = await Promise.all([loadState(now, undefined, releases), variable(STUDIO_MARKS_VAR), variable(BOARD_VAR)]);
    const zones = buildBoard({
      now,
      ru: state,
      en: {
        name: langChannel("en").name,
        json: langChannelJson("en"),
        released: langVideosOf(await releases, "en").map((v) => v.code),
        marks: studioRaw ? (parseStudioMarks(studioRaw.raw).en ?? {}) : null,
      },
      marks: boardRaw ? parseBoardMarks(boardRaw.raw) : null,
    });
    const active = state.runs.filter((r) => r.active);
    data = {
      plan: layoutBoard(zones, state.todayKey),
      todayKey: state.todayKey,
      shell: { updated: state.updatedLabel, generatedAt: state.generatedAt, activeRuns: active.length, activeIds: active.map((r) => r.id), runwayDays: state.runwayDays, runwayLabel: state.runwayLabel },
    };
  } catch (e) {
    return <ErrorScreen title="Не получилось собрать доску" message={e instanceof Error ? e.message : String(e)} />;
  }
  return <BoardCanvas data={data} />;
}
