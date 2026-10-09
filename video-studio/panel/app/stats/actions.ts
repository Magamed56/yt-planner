"use server";
// Действия экрана «Статистика»: плейлисты рубрик, подбор новых названий (workflow) и смена
// названия ролика. Каждое проверяет вход само (действие сервера — это POST), ключи остаются на сервере.
import { channelFromJson } from "../../../src/pipeline/channel";
import { parsePlan, PLAN_CODE } from "../../../src/pipeline/plan";
import { parseTitleIdeas, TITLE_IDEAS_FILE } from "../../../src/pipeline/title-ideas";
import type { ActionResult } from "@/app/actions";
import { requireSession } from "@/lib/auth";
import { dispatchOnce } from "@/lib/dispatch";
import { GithubError, readJson, setVariable } from "@/lib/github";
import { loadState, STUDIO_DIR } from "@/lib/load";
import { applyPlaylistSync, computePlaylistSync, readPlaylistsSetting } from "@/lib/playlist-sync";
import { PLAYLIST_MAX_INSERTS, PLAYLISTS_VAR, playlistsSettingText, quotaLabel } from "@/lib/playlists";
import { codesLabel, plural } from "@/lib/stages";
import { allowedTitle, titleUpdateBody } from "@/lib/titles";
import { updateVideoSnippet, videoSnippet } from "@/lib/youtube-tools";

const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function guarded<T extends ActionResult>(fn: () => Promise<T>): Promise<T | ActionResult> {
  try {
    await requireSession();
    return await fn();
  } catch (e) {
    return fail(errorText(e));
  }
}

const videosWord = (n: number) => `${n} ${plural(n, "ролик", "ролика", "роликов")}`;

// ---- плейлисты рубрик ----

export interface PlaylistPreview extends ActionResult {
  create: string[]; // названия новых плейлистов
  add: { title: string; codes: string[] }[]; // по плейлистам
  addCount: number;
  already: number;
  deferred: number; // не влезли в лимит за раз
  inserts: number;
  quota: string; // «≈ 750 единиц из 10 000 в сутки»
  maxInserts: number;
  auto: boolean;
}

export async function playlistPreviewAction(): Promise<PlaylistPreview | ActionResult> {
  return guarded(async () => {
    const { plan, setting } = await computePlaylistSync();
    const add = plan.pillars
      .map((p) => ({ title: p.title, codes: plan.add.filter((a) => a.pillar === p.pillar).map((a) => a.code) }))
      .filter((x) => x.codes.length);
    return {
      ok: true,
      message: "",
      create: plan.create.map((c) => c.title),
      add,
      addCount: plan.add.length,
      already: plan.already,
      deferred: plan.deferred,
      inserts: plan.inserts,
      quota: quotaLabel(plan.units),
      maxInserts: PLAYLIST_MAX_INSERTS,
      auto: setting.auto,
    };
  });
}

export async function playlistApplyAction(): Promise<ActionResult> {
  return guarded(async () => {
    const r = await applyPlaylistSync();
    const parts = [
      r.created.length ? `создано: ${r.created.map((t) => `«${t}»`).join(", ")}` : "",
      r.added.length ? `добавлено ${videosWord(r.added.length)} (${codesLabel(r.added)})` : "",
      r.deferred ? `ещё ${videosWord(r.deferred)} — следующим «Применить» (не больше ${PLAYLIST_MAX_INSERTS} вставок за раз)` : "",
    ].filter(Boolean);
    const done = parts.length ? `Плейлисты: ${parts.join("; ")}.` : "Плейлисты уже в порядке — добавлять нечего.";
    return { ok: r.problems.length === 0 || r.created.length + r.added.length > 0, message: r.problems.length ? `${done} Не вышло — ${r.problems.join("; ")}` : done };
  });
}

export async function playlistAutoAction(enabled: boolean): Promise<ActionResult> {
  return guarded(async () => {
    const setting = await readPlaylistsSetting();
    await setVariable(PLAYLISTS_VAR, playlistsSettingText({ ...setting, auto: enabled === true }));
    return ok(
      enabled === true
        ? "Сохранено: «Найти новые загрузки» будет сразу добавлять ролики в плейлист их рубрики (+50 единиц квоты на ролик)."
        : "Сохранено: новые ролики в плейлисты сами не добавляются — только кнопкой «Применить».",
    );
  });
}

// ---- новые названия ----

const MAX_CODES = 10;

export async function titleIdeasAction(codes: string[]): Promise<ActionResult> {
  return guarded(async () => {
    const plan = parsePlan(await readJson(`${STUDIO_DIR}/content/plan.json`));
    const want = new Set((Array.isArray(codes) ? codes : []).map((c) => String(c).trim().toLowerCase()).filter((c) => PLAN_CODE.test(c)));
    const list = plan.items.map((i) => i.id).filter((id) => want.has(id)).slice(0, MAX_CODES);
    if (!list.length) return fail("Нет роликов из плана — обновите страницу.");
    const channel = channelFromJson((await readJson(`${STUDIO_DIR}/channel.json`)) ?? {});
    try {
      await dispatchOnce("video-studio-titles.yml", { codes: list.join(",") }, "other", list, channel.schedule.timezone);
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) throw new Error("Workflow «video-studio: названия» ещё не в ветке — слейте PR с ним.");
      throw e;
    }
    return ok(`Запущен подбор названий: ${codesLabel(list)}. Обычно 1–3 минуты (если не ждёт в очереди за сборкой) — потом обновите страницу.`);
  });
}

// Только название из идей ролика или его прежнее (из того же файла): произвольный текст
// с панели на YouTube не уходит. Остальные поля snippet переносим как есть.
export async function applyTitleAction(code: string, videoId: string, title: string): Promise<ActionResult> {
  return guarded(async () => {
    const c = String(code ?? "").trim().toLowerCase();
    if (!PLAN_CODE.test(c) || !/^[\w-]{6,20}$/.test(String(videoId ?? ""))) return fail("Неверный запрос — обновите страницу.");
    const [state, ideasJson] = await Promise.all([loadState(), readJson(`${STUDIO_DIR}/${TITLE_IDEAS_FILE}`)]);
    const row = state.rows.find((r) => r.code === c);
    if (!row?.youtube || row.youtube.videoId !== videoId) return fail(`Ролик ${c} на YouTube не найден или сменился — обновите страницу.`);
    const next = allowedTitle(parseTitleIdeas(ideasJson), c, String(title ?? ""));
    if (!next) return fail("Такого варианта нет среди идей — обновите страницу.");
    const snippet = await videoSnippet(videoId);
    if (!snippet) return fail("YouTube не вернул ролик — обновите страницу.");
    const before = snippet.title ?? "";
    if (before === next) return ok(`У ${c} уже стоит это название.`);
    const confirmed = await updateVideoSnippet(titleUpdateBody(videoId, snippet, next));
    if (!confirmed) return fail("YouTube не подтвердил новое название — проверьте ролик в Studio.");
    return ok(`Название ${c} сменено. Было: «${before}». Стало: «${confirmed}».`);
  });
}
