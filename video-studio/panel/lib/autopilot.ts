// Автопилот: раз в день (Vercel Cron) смотрит, готовы ли ролики, которые выйдут в ближайшие
// N дней, и для недостающих запускает «video-studio: ролик» — mode batch, plan = коды:
// сценарий пишет Claude, ролик собирается в релиз. В Studio не грузит — это руками.
import { dispatchWorkflow, getVariable, setVariable } from "./github";
import { loadState } from "./load";
import { AUTOPILOT_LAST_VAR, AUTOPILOT_VAR, codesLabel, parseAutopilot, type AutopilotLast, type AutopilotSettings, type PanelState } from "./state";

// Бесплатный Gemini TTS — около 10 запросов в сутки: больше 6 роликов за запуск не просим.
export const AUTOPILOT_MAX = 6;

export function decideAutopilot(state: PanelState, settings: AutopilotSettings, now: Date): { codes: string[]; skip: string | null } {
  // Без YouTube не видно расписания: ориентиры дат съехали бы, и собралось бы лишнее.
  if (state.youtubeError) return { codes: [], skip: `YouTube недоступен (${state.youtubeError}) — пропускаю, чтобы не собрать лишнего` };
  const horizon = now.getTime() + settings.days * 86_400_000;
  const need = state.rows.filter((r) => (r.stage === "topic" || r.stage === "script") && !r.running && r.when && Date.parse(r.when) <= horizon);
  if (!need.length) return { codes: [], skip: `всё, что выходит в ближайшие ${settings.days} дн., уже готово или в работе` };
  const missing = state.missingSecrets ?? [];
  if (missing.includes("GEMINI_API_KEY")) return { codes: [], skip: "в секретах GitHub нет GEMINI_API_KEY — без него голос был бы не Charon" };
  if (missing.includes("ANTHROPIC_API_KEY") && need.some((r) => r.stage === "topic")) return { codes: [], skip: "в секретах GitHub нет ANTHROPIC_API_KEY — сценарии писать нечем" };
  return { codes: need.slice(0, AUTOPILOT_MAX).map((r) => r.code), skip: null };
}

export async function runAutopilot(source: "cron" | "manual", now = new Date()): Promise<AutopilotLast> {
  const settings = parseAutopilot(await getVariable(AUTOPILOT_VAR).catch(() => null));
  const who = source === "cron" ? "по расписанию" : "вручную";
  if (source === "cron" && !settings.enabled) return { at: now.toISOString(), action: "автопилот выключен", codes: [], note: "" };
  const state = await loadState(now);
  const { codes, skip } = decideAutopilot(state, settings, now);
  let last: AutopilotLast;
  if (skip) {
    last = { at: now.toISOString(), action: `${who}: ничего не запущено`, codes: [], note: skip };
  } else {
    await dispatchWorkflow("video-studio.yml", { mode: "batch", plan: codes.join(","), upload: "release" });
    last = { at: now.toISOString(), action: `${who}: запущены сценарии и видео`, codes, note: `${codesLabel(codes)} — «video-studio: ролик», batch, в релиз` };
  }
  // Без права Variables: Write отметка не сохранится — сам запуск от этого не зависит.
  await setVariable(AUTOPILOT_LAST_VAR, JSON.stringify(last)).catch(() => {});
  return last;
}
