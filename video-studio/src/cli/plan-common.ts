// Общее для plan-extend и plan-sequel: чтение плана и канала, запись плана,
// сводка в консоль и в GitHub Actions.
import fs from "node:fs";
import path from "node:path";
import { channelFile, loadChannel } from "../pipeline/channel-file";
import { parsePlan, refreshPlanStats, type ContentPlan, type PlanItem } from "../pipeline/plan";
import { loadCovered, type CoveredEntry } from "../pipeline/script/covered";
import type { PlanChannel } from "../pipeline/script/plan-gen";
import { ROOT, UserError, escapeMd, ghOutput, ghSummary, rel, writeJson } from "./common";

export const PLAN_FILE = path.join(ROOT, "content", "plan.json");

export function readPlan(): ContentPlan {
  try {
    return parsePlan(JSON.parse(fs.readFileSync(PLAN_FILE, "utf8").replace(/^﻿/, "")));
  } catch (e) {
    throw new UserError(`Не прочитать ${rel(PLAN_FILE)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Ниша, аудитория и рубрики — из channel.json (их нет в разобранном ChannelConfig),
// слоты дня — из расписания канала.
export function readChannelInfo(plan: ContentPlan): { channel: PlanChannel; pillars: { id: string; title: string }[]; slots: string[] } {
  const cfg = loadChannel();
  let raw: Record<string, unknown> = {};
  const file = channelFile();
  try {
    if (file && fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
  } catch {
    raw = {}; // loadChannel выше уже сказал бы про битый файл
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fromList = (v: unknown) =>
    Array.isArray(v)
      ? v
          .map((p) => (p && typeof p === "object" ? { id: str((p as Record<string, unknown>).id), title: str((p as Record<string, unknown>).title) } : null))
          .filter((p): p is { id: string; title: string } => Boolean(p?.id && p.title))
      : [];
  const pillars = fromList(plan.pillars).length ? fromList(plan.pillars) : fromList(raw.pillars);
  if (!pillars.length) throw new UserError("Нет рубрик: ни в content/plan.json (pillars), ни в channel.json (pillars).");
  return {
    channel: { name: cfg.name ?? str(plan.channel), niche: str(raw.niche), audience: str(raw.audience) },
    pillars,
    slots: cfg.schedule.publishTimesLocal,
  };
}

// Для новых тем «уже было» — не только снятое, но и всё, что уже стоит в плане.
export function planCovered(plan: ContentPlan): CoveredEntry[] {
  const covered = loadCovered(ROOT, { plan });
  for (const it of plan.items) {
    const claims = it.keyFacts.map((f) => f.claim.trim()).filter(Boolean);
    if (claims.length && !covered.some((e) => e.code === it.id)) covered.push({ code: it.id, title: it.title, texts: claims });
  }
  return covered;
}

export function savePlan(plan: ContentPlan, added: PlanItem[]): void {
  plan.items.push(...added);
  refreshPlanStats(plan);
  writeJson(PLAN_FILE, plan);
}

export function reportNewTopics(what: string, items: PlanItem[], notes: string[], missing: string[], dryRun: boolean, pillarTitle: (id: string) => string): void {
  console.log(`\n${items.length ? "✔" : "✖"} ${what}: ${items.length}${dryRun ? " (--dry-run: план не записан)" : ` → ${rel(PLAN_FILE)}`}`);
  for (const it of items) {
    console.log(`  ${it.id} · ${pillarTitle(it.pillar)} · «${it.title}»`);
    for (const f of it.keyFacts) console.log(`      — ${f.claim.slice(0, 110)}${f.claim.length > 110 ? "…" : ""}\n        ${f.source}`);
  }
  if (missing.length) console.log(`  не заполнены: ${missing.join(", ")} — запустите ещё раз`);
  for (const n of notes) console.log(`  замечание: ${n}`);
  ghOutput({ codes: items.map((i) => i.id).join(","), count: items.length });
  ghSummary(
    [
      `## 🗂 ${what}: ${items.length}`,
      "",
      "| Код | Рубрика | Тема | Факты |",
      "|---|---|---|---|",
      ...items.map((i) => `| ${i.id} | ${escapeMd(pillarTitle(i.pillar))} | ${escapeMd(i.title)} | ${i.keyFacts.map((f, k) => `[${k + 1}](${f.source})`).join(" ")} |`),
      "",
      missing.length ? `Не заполнены: ${missing.join(", ")}.` : "",
      notes.length ? `<details><summary>Замечания (${notes.length})</summary>\n\n${notes.map((n) => `- ${escapeMd(n)}`).join("\n")}\n\n</details>` : "",
      "",
    ].join("\n"),
  );
}
