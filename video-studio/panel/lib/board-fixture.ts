// Фикстура «Доски» — без сети и файлов: свой маленький план, ролики на YouTube, релизы (русские и
// en-…), отметки PANEL_BOARD и PANEL_LANG_STUDIO, свой channels/en.json. Очередь собирает
// настоящий buildState (state.ts), поэтому на демо-странице (app/board/demo, только в разработке)
// работает и карточка ролика (VideoSheet). Её же проверяет scripts/board-test.ts — от того, докуда
// дошёл настоящий план, тест не зависит.
import ruChannel from "../../channel.json";
import type { ChannelVideo } from "../../src/pipeline/youtube-fill";
import type { GhRelease } from "./github";
import { parseBoardMarks } from "./board";
import type { StudioMarks } from "./lang-plan";
import { buildState, parseAutopilot, type PanelState } from "./state";

// Воскресенье, 11.10.2026, 13:00 по Москве.
export const FIXTURE_NOW = new Date("2026-10-11T10:00:00Z");

// Свой файл канала на английском: старт 09.10, 12:00 и 19:00 по Нью-Йорку.
export const FIXTURE_EN_JSON = {
  name: "Gist in a Minute",
  schedule: { start: "2026-10-09", timezone: "America/New_York", publishTimesLocal: ["12:00", "19:00"] },
};

const TITLES: [string, string, string][] = [
  ["01a", "Почему свой голос на записи звучит чужим", "Why your voice sounds weird on recordings"],
  ["01b", "Клеопатра ближе к нам, чем к строителям пирамид", "Cleopatra lived closer to us than to the pyramid builders"],
  ["02a", "На Венере день длиннее года", "A day on Venus is longer than its year"],
  ["02b", "Почему невозможно пощекотать самого себя", "Why can't you tickle yourself"],
  ["03a", "Три сердца и голубая кровь осьминога", "Octopus: three hearts and blue blood"],
  ["03b", "Самый знаменитый баг был настоящим насекомым", "The most famous computer bug was a real insect"],
  ["04a", "Бактерий в тебе не в 10 раз больше, чем клеток", "You are not 90% bacteria"],
  ["04b", "Монополию придумали, чтобы показать вред монополий", "Monopoly was invented to warn against monopolies"],
  ["05a", "Невидимая горилла: почему ты не видишь очевидное", "The invisible gorilla"],
  ["05b", "16 рассветов за сутки: как живут на МКС", "16 sunrises a day on the ISS"],
  ["06a", "Рогатые шлемы викингов — выдумка художников", "Vikings never wore horned helmets"],
  ["06b", "Эта акула может быть старше Санкт-Петербурга", "This shark may be older than the US"],
  ["07a", "Интернет лежит на дне океана. Буквально", "The internet lies on the ocean floor"],
  ["07b", "Почему от лука текут слёзы: простая химия", "Why onions make you cry"],
  ["08a", "Почему цены заканчиваются на 99", "Why prices end in 99"],
  ["08b", "Утром ты выше, чем вечером", "You are taller in the morning"],
  ["09a", "Мамонты ещё жили, когда строили пирамиды", "Mammoths were alive when the pyramids were built"],
  ["09b", "Солнце, которое ты видишь, — восьмиминутной давности", "The Sun you see is 8 minutes old"],
  ["10a", "Почему зевота заразна", "Why yawning is contagious"],
  ["10b", "Сколько весит облако", "How much does a cloud weigh"],
  ["11a", "Почему небо голубое, а закат красный", "Why the sky is blue"],
  ["11b", "Кошки мурчат не только от радости", "Cats don't purr only when happy"],
  ["12a", "Почему мы забываем сны", "Why we forget dreams"],
  ["12b", "Сколько звёзд видно без телескопа", "How many stars can you see"],
];

const plan = {
  pillars: [{ id: "why", title: "Почему так?" }],
  items: TITLES.map(([id, title], i) => ({
    id,
    day: Math.floor(i / 2) + 1,
    slot: id.endsWith("a") ? "12:00" : "19:00",
    pillar: "why",
    title,
    hook: `${title}?`,
    angle: "Объяснить за минуту, без мифов.",
    keyFacts: [{ claim: "Проверяемый факт по теме.", source: "https://example.org" }],
    status: "planned",
  })),
};
const longPlan = {
  pillars: [{ id: "why", title: "Почему так?" }],
  items: [
    { id: "L01", day: 1, slot: "21:00", pillar: "why", title: "Эффект Даннинга — Крюгера простыми словами", hook: "", angle: "", keyFacts: [], status: "planned" },
    { id: "L02", day: 2, slot: "21:00", pillar: "why", title: "Как работает память", hook: "", angle: "", keyFacts: [], status: "planned" },
  ],
};

// Обложка-заглушка 9:16 без сети: градиент и код ролика.
function poster(code: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160" viewBox="0 0 90 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 60% 25%)"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/><text x="45" y="92" font-family="sans-serif" font-size="26" font-weight="900" fill="#fff" text-anchor="middle">${code}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// 12:00 и 19:00 по Москве — 09:00 и 16:00 UTC.
const slot = (day: string, evening: boolean) => `2026-10-${day}T${evening ? "16" : "09"}:00:00Z`;

function video(code: string, i: number, over: Partial<ChannelVideo>): ChannelVideo {
  return {
    videoId: `v${code}xxxx`,
    title: TITLES.find((t) => t[0] === code)?.[1] ?? code,
    description: "",
    fileName: `${code}-video.mp4`,
    durationSec: code.startsWith("L") ? 420 : 55,
    uploadStatus: "processed",
    privacyStatus: "private",
    publishAt: null,
    embeddable: true,
    license: "youtube",
    publicStatsViewable: true,
    tags: [],
    categoryId: "27",
    publishedAt: "2026-10-05T10:00:00Z",
    thumbnailUrl: poster(code, (i * 37) % 360),
    viewCount: 1200 + i * 310,
    likeCount: 40 + i,
    commentCount: 3,
    ...over,
  };
}

// На канале: 01a–06a вышли (06.10–11.10), 06b–08a стоят в расписании до 13.10 12:00, 13.10 в 19:00 —
// дыра, 08b загружен в Studio без времени, 09a стоит на 14.10. «Разбор» L01 вышел 08.10.
const videos: ChannelVideo[] = [
  ...["01a", "01b", "02a", "02b", "03a", "03b", "04a", "04b", "05a", "05b", "06a"].map((code, i) =>
    video(code, i, { privacyStatus: "public", publishedAt: slot(String(6 + Math.floor(i / 2)).padStart(2, "0"), i % 2 === 1) }),
  ),
  video("06b", 11, { publishAt: slot("11", true) }),
  video("07a", 12, { publishAt: slot("12", false) }),
  video("07b", 13, { publishAt: slot("12", true) }),
  video("08a", 14, { publishAt: slot("13", false) }),
  video("08b", 15, { publishedAt: "2026-10-10T08:00:00Z" }),
  video("09a", 16, { publishAt: slot("14", false) }),
  video("L01", 17, { privacyStatus: "public", publishedAt: "2026-10-08T18:00:00Z" }),
];

let assetId = 1000;
function release(code: string, opts: { lang?: string; body?: string; cover?: boolean; at?: string } = {}): GhRelease {
  const file = opts.lang ? `${opts.lang}-${code}-video.mp4` : `${code}-video.mp4`;
  const at = opts.at ?? "2026-10-09T08:00:00Z";
  return {
    id: assetId++,
    tag_name: `video-${opts.lang ? `${opts.lang}-` : ""}${code}`,
    name: code,
    html_url: `https://github.com/x/y/releases/tag/video-${code}`,
    created_at: at,
    published_at: at,
    draft: false,
    body: opts.body ?? null,
    assets: [
      { id: assetId++, name: file, size: 18_000_000 },
      ...(opts.cover === false ? [] : [{ id: assetId++, name: "cover.jpg", size: 90_000 }]),
      { id: assetId++, name: "instagram.txt", size: 700 },
      { id: assetId++, name: "description.txt", size: 2000 },
    ],
  };
}
const enBody = (title: string) => `НАЗВАНИЕ\n${title}\n\nОПИСАНИЕ\n${title} — explained in a minute.\n\n#shorts #facts\n\nТЕГИ (поле «Теги» в YouTube Studio)\nfacts, science, gist\n`;

const releases: GhRelease[] = [
  // Русские: у вышедших и запланированных файлы ещё лежат в релизах; 09b–10b — готовы к загрузке.
  ...["01a", "01b", "02a", "02b", "03a", "03b", "04a", "04b", "05a", "05b", "06a", "06b", "07a", "07b", "08a", "08b", "09a", "09b", "10a", "10b"].map((c) => release(c)),
  // Английские: 01a–04b собраны.
  ...TITLES.slice(0, 8).map(([code, , en]) => release(code, { lang: "en", body: enBody(en) })),
];

// Отметки: в Instagram выложены 01a–04b, 06b поставлен на 11.10 19:00; в TikTok — 01a–03a.
const at = (iso: string) => iso;
const boardMarks = {
  instagram: Object.fromEntries([
    ...["01a", "01b", "02a", "02b", "03a", "03b", "04a", "04b"].map((c, i) => [c, at(slot(String(6 + Math.floor(i / 2)).padStart(2, "0"), i % 2 === 1))]),
    ["06b", slot("11", true)],
  ]),
  tiktok: Object.fromEntries(["01a", "01b", "02a", "02b", "03a"].map((c, i) => [c, at(slot(String(6 + Math.floor(i / 2)).padStart(2, "0"), i % 2 === 1))])),
};
// В Studio английского канала отмечены 01a–02b (уже вышли) и 03a (впереди).
const enMarks = { "01a": "2026-10-09T16:00:00Z", "01b": "2026-10-09T23:00:00Z", "02a": "2026-10-10T16:00:00Z", "02b": "2026-10-10T23:00:00Z", "03a": "2026-10-11T16:00:00Z" };

export interface BoardFixture {
  now: Date;
  state: PanelState;
  releases: GhRelease[];
  enJson: unknown;
  enMarks: Record<string, number>;
  boardMarks: StudioMarks;
}

// youtubeError — YouTube «не ответил»: очередь без него, как на настоящей странице.
export function boardFixture(opts: { youtubeError?: string } = {}): BoardFixture {
  const state = buildState({
    now: FIXTURE_NOW,
    planJson: plan,
    channelJson: ruChannel,
    scriptFiles: ["sut-11a-x.json", "sut-11b-x.json", "sut-12a-x.json", "razbor-L02-x.json"],
    fillLists: [null, null],
    releases,
    runs: [],
    videos: opts.youtubeError ? null : videos,
    youtubeError: opts.youtubeError ?? null,
    secretNames: ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"],
    autopilot: parseAutopilot(null),
    autopilotLast: null,
    repo: "x/y",
    branch: "master",
    longPlanJson: longPlan,
    // 10a ждёт пересборки: его релиз собран до since.
    rebuildJson: { since: "2026-10-10T00:00:00Z", reason: "голос нарезан не по речи", codes: ["10a"] },
  });
  return {
    now: FIXTURE_NOW,
    state,
    releases,
    enJson: FIXTURE_EN_JSON,
    enMarks: Object.fromEntries(Object.entries(enMarks).map(([c, t]) => [c, Date.parse(t)])),
    boardMarks: parseBoardMarks(JSON.stringify(boardMarks)),
  };
}
