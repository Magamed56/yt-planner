// Метаданные для YouTube: заголовок, описание с источниками, теги. Один и тот
// же объект пишется в description.txt (для ручной загрузки) и youtube.json
// (для загрузки через API), чтобы на YouTube ушло ровно то, что проверил
// человек.

import type { Credit } from "./contracts";
import type { Format, VideoScript } from "../types";
import { normalizeHashtag, topicHashtags, uniqueHashtags, type ChannelConfig } from "./channel";

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
  categoryId: string; // 27 = Education
  defaultLanguage: string;
  containsSyntheticMedia: boolean;
}

export interface MetaInput {
  script: VideoScript;
  format: Format;
  visualCredits: (Credit | null | undefined)[];
  musicCredit: string | null;
  voiceProvider: string; // имя провайдера из модуля voice
  voiceName?: string | null;
  // Канал из channel.json: хэштеги бренда, призыв, ссылки и дисклеймер в
  // описании, имя канала — в тегах. Не задан — описание как раньше.
  channel?: ChannelConfig | null;
}

// YouTube API отвергает «<» и «>» в заголовке и описании (invalidTitle /
// invalidDescription), лимиты: заголовок 100 символов, теги 500 символов,
// описание — 5000 БАЙТ UTF-8 (не символов!): кириллица занимает 2 байта на
// букву, так что русское описание упирается в лимит уже на ~2500 символах.
const stripAngles = (s: string) => s.replace(/[<>]/g, "");
const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
const TAGS_TOTAL_MAX = 500;
const utf8Bytes = (s: string) => Buffer.byteLength(s, "utf8");

const VOICE_TITLES: Record<string, string> = {
  edge: "Microsoft Edge TTS",
  piper: "Piper TTS",
  gemini: "Google Gemini TTS",
  elevenlabs: "ElevenLabs",
  openai: "синтез речи (OpenAI-совместимый сервер)",
  fish: "Fish Speech",
};

const AI_VISUAL = /cloudflare|flux|sdxl|stable diffusion|pollinations/i;

export function voiceCreditLine(provider: string, voice?: string | null): string {
  const title = VOICE_TITLES[provider] ?? provider;
  return `Озвучка: синтезированный голос — ${title}${voice ? `, голос ${voice}` : ""}`;
}

function creditLine(c: Credit): string {
  const who = c.author ? ` — ${c.author}` : "";
  const url = c.url ? ` ${c.url}` : "";
  return `${c.provider}${who}${url}`;
}

interface CreditParts {
  stock: { line: string; provider: string }[]; // по строке на клип/фото (Pexels, Pixabay)
  ai: string[];
  music: string | null;
  voice: string;
}

function creditParts(input: Pick<MetaInput, "visualCredits" | "musicCredit" | "voiceProvider" | "voiceName">): CreditParts {
  const seen = new Set<string>();
  const stock: CreditParts["stock"] = [];
  const ai = new Set<string>();
  for (const c of input.visualCredits) {
    if (!c) continue;
    if (AI_VISUAL.test(c.provider)) {
      ai.add(c.provider);
      continue;
    }
    const line = creditLine(c);
    if (seen.has(line)) continue;
    seen.add(line);
    stock.push({ line, provider: c.provider });
  }
  return { stock, ai: [...ai], music: input.musicCredit, voice: voiceCreditLine(input.voiceProvider, input.voiceName) };
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// stockShown — сколько строк стоковых источников показать; остальные
// сворачиваются в «… и ещё N». Pexels и Pixabay атрибуцию не требуют, а вот
// строки ИИ, музыки (CC BY) и голоса не сокращаются никогда.
function creditLines(p: CreditParts, stockShown = p.stock.length): string[] {
  const lines: string[] = [];
  if (p.stock.length) {
    lines.push("Видео и фото:");
    for (const s of p.stock.slice(0, stockShown)) lines.push(`• ${s.line}`);
    const rest = p.stock.slice(stockShown);
    if (rest.length) {
      const providers = [...new Set(rest.map((s) => s.provider))].join(", ");
      lines.push(`• … и ещё ${rest.length} ${ruPlural(rest.length, "источник", "источника", "источников")} (${providers})`);
    }
  }
  if (p.ai.length) lines.push(`Часть изображений сгенерирована ИИ (${p.ai.join(", ")}).`);
  if (p.music) lines.push(`Музыка: ${p.music}`);
  lines.push(p.voice);
  return lines;
}

export function creditsBlock(input: Pick<MetaInput, "visualCredits" | "musicCredit" | "voiceProvider" | "voiceName">): string[] {
  return creditLines(creditParts(input));
}

function fitTags(tags: string[], format: Format, extra: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Теги сценария важнее: бренд и общие теги канала — после них (лимит 500 символов режет хвост).
  const base = [...tags, ...extra];
  const all = format === "shorts" && !base.some((t) => t.toLowerCase() === "shorts") ? [...base, "shorts"] : base;
  let total = 0;
  for (const raw of all) {
    const t = stripAngles(raw).replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    // YouTube считает кавычки вокруг тегов с пробелами и запятые между тегами.
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > TAGS_TOTAL_MAX) break;
    seen.add(t.toLowerCase());
    out.push(t);
    total += cost;
  }
  return out;
}

// До трёх хэштегов из тегов (их YouTube показывает над заголовком).
function hashtags(tags: string[], format: Format): string {
  const picked = tags
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((t) => t.length >= 2)
    .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
    .filter((t) => t.toLowerCase() !== "shorts")
    .slice(0, format === "shorts" ? 2 : 3)
    .map((t) => `#${t}`);
  if (format === "shorts") picked.push("#shorts");
  return picked.join(" ");
}

// Хэштеги с каналом: бренд, 2 по теме ролика, общие канала, #shorts — не
// больше 8 (при 15+ YouTube игнорирует все). Уже стоящие в тексте не дублируем.
function channelHashtags(ch: ChannelConfig, tags: string[], format: Format, body: string): string {
  const inBody = new Set((body.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.toLowerCase()));
  const shorts = format === "shorts" ? (ch.hashtags.youtubeShorts.length ? ch.hashtags.youtubeShorts : ["#shorts"]) : [];
  const head = uniqueHashtags([...ch.hashtags.brand, ...topicHashtags(tags, 2), ...ch.hashtags.core]).filter((h) => !inBody.has(h.toLowerCase()));
  const tail = shorts.filter((h) => !inBody.has(h.toLowerCase()));
  return uniqueHashtags([...head.slice(0, Math.max(0, 8 - tail.length)), ...tail]).join(" ");
}

// Подвал описания канала: призыв к комментарию, подписка, Instagram, дисклеймер.
// Без ссылок: в описании Shorts они не кликаются, а у нового канала ссылки в описании
// считаются признаком спама. Ссылки канала — в поле «Ссылки» профиля (channel.json → links).
function channelFooter(ch: ChannelConfig): string[] {
  const lines: string[] = [];
  if (ch.cta.comment) lines.push(`💬 ${ch.cta.comment.replace(/[.!]+$/, "")} 👇`);
  if (ch.cta.subscribe) lines.push(`🔔 ${ch.cta.subscribe}`);
  if (ch.links.instagram && ch.name) lines.push(`📱 Мы есть и в Instagram — ищи «${ch.name}»`);
  return lines;
}

// Теги канала: имя канала (по нему ищут), затем общие хэштеги без «#».
function channelTags(ch: ChannelConfig): string[] {
  const out: string[] = [];
  if (ch.name) out.push(ch.name.toLowerCase());
  for (const h of [...ch.hashtags.core]) {
    const t = normalizeHashtag(h)?.slice(1);
    if (t) out.push(t);
  }
  return out;
}

export function buildYoutubeMeta(input: MetaInput): YoutubeMeta {
  const { script, format } = input;
  const ch = input.channel ?? null;
  const title = stripAngles(script.title).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || "Без названия";
  const tags = fitTags(script.tags ?? [], format, ch ? channelTags(ch) : []);
  const body = stripAngles(script.description ?? "").trim();
  // Хэштеги уже могли быть в описании от сценариста — тогда только #shorts.
  const hasHashtags = /#[\p{L}\p{N}_]+/u.test(body);
  const tagLine = ch
    ? channelHashtags(ch, script.tags ?? [], format, body)
    : hasHashtags
      ? format === "shorts" && !/#shorts\b/i.test(body)
        ? "#shorts"
        : ""
      : hashtags(tags, format);
  const credits = creditParts(input);
  const footer = ch ? stripAngles(channelFooter(ch).join("\n")) : "";
  const disclaimer = ch?.disclaimer ? stripAngles(ch.disclaimer) : "";
  // Порядок: текст → призыв и ссылки → хэштеги → источники → дисклеймер.
  // Подвал канала не урезается никогда — сокращаются только стоки и текст.
  const compose = (text: string, stockShown: number) =>
    [text, footer, tagLine, creditLines(credits, stockShown).join("\n"), disclaimer].filter(Boolean).join("\n\n");
  // Не влезает в 5000 байт — сначала сворачиваем строки стоков с конца
  // (у длинного ролика их десятки), и только в крайнем случае режем текст
  // сценариста — по границе символа, чтобы не разрезать букву пополам.
  let shown = credits.stock.length;
  let description = compose(body, shown);
  while (utf8Bytes(description) > DESCRIPTION_MAX_BYTES && shown > 0) description = compose(body, --shown);
  if (utf8Bytes(description) > DESCRIPTION_MAX_BYTES) {
    const budget = DESCRIPTION_MAX_BYTES - (utf8Bytes(compose("x", shown)) - 1) - utf8Bytes("…");
    const chars = Array.from(body);
    let size = utf8Bytes(body);
    while (chars.length && size > budget) size -= utf8Bytes(chars.pop()!);
    description = compose(chars.join("").trimEnd() + "…", shown);
  }
  const synthetic = (process.env.YT_SYNTHETIC_MEDIA ?? "1").trim().toLowerCase();
  return {
    title,
    description,
    tags,
    categoryId: process.env.YT_CATEGORY_ID?.trim() || "27",
    defaultLanguage: script.language || "ru",
    // Голос синтезирован — честно отмечаем «изменённый или синтетический
    // контент» (YouTube требует это для реалистичного ИИ-контента; лишняя
    // пометка не вредит). YT_SYNTHETIC_MEDIA=0 — отключить.
    containsSyntheticMedia: !["0", "false", "no", "нет"].includes(synthetic),
  };
}

// Текст description.txt: всё, что нужно вставить в YouTube Studio руками.
export function descriptionTxt(meta: YoutubeMeta): string {
  return [
    "НАЗВАНИЕ",
    meta.title,
    "",
    "ОПИСАНИЕ",
    meta.description,
    "",
    "ТЕГИ (поле «Теги» в YouTube Studio)",
    meta.tags.join(", "),
    "",
    `Категория: ${meta.categoryId === "27" ? "Образование (27)" : meta.categoryId}; «Изменённый или синтетический контент»: ${meta.containsSyntheticMedia ? "да" : "нет"}; «Для детей»: нет.`,
    "",
  ].join("\n");
}
