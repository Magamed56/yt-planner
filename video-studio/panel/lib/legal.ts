// Данные открытых страниц /privacy и /terms. Имя и ссылка канала — из channel.json прямо в
// сборке: страницы читает проверка Google, и они не должны падать вместе с GitHub API. Почта для
// вопросов — PANEL_CONTACT_EMAIL (в репозиторий личную почту не кладём).
import channelJson from "../../channel.json";
import { channelFromJson } from "../../src/pipeline/channel";

export const LEGAL_UPDATED = { ru: "9 октября 2026 г.", en: "October 9, 2026" };

export function legalInfo() {
  const channel = channelFromJson(channelJson, process.env);
  return {
    name: channel.name ?? "YouTube",
    youtube: channel.links.youtube,
    email: process.env.PANEL_CONTACT_EMAIL?.trim() || null,
  };
}
