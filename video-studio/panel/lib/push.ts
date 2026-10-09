// Уведомления на телефон (Web Push) без пакетов, на node:crypto: подпись VAPID (RFC 8292, JWT
// ES256) и шифрование aes128gcm (RFC 8291 + RFC 8188). Подписки устройств — в переменной
// репозитория PANEL_PUSH_SUBS: базы у панели нет, а переменные GitHub она уже читает и пишет.
// Подписка без закрытого ключа VAPID бесполезна: служба push проверяет подпись каждого запроса.
import { createCipheriv, createECDH, createHash, hkdfSync, randomBytes, sign } from "node:crypto";
import { getVariable, setVariable } from "./github";

export const PUSH_SUBS_VAR = "PANEL_PUSH_SUBS";
export const PUSH_MAX_DEVICES = 10;
// Одна запись aes128gcm на сообщение (RFC 8291 §4): 4096 − заголовок 86 − разделитель 1 − тег 16.
export const PUSH_MAX_PLAINTEXT = 3993;
const RECORD_SIZE = 4096;
const SEND_TIMEOUT_MS = 10_000;
const VAPID_JWT_SEC = 12 * 3600; // RFC 8292: не дольше суток
const DEFAULT_TTL_SEC = 12 * 3600; // сколько служба push хранит сообщение для выключенного телефона

export type Urgency = "very-low" | "low" | "normal" | "high";

export interface PushKeys {
  p256dh: string;
  auth: string;
}

export interface PushSub {
  endpoint: string;
  keys: PushKeys;
  label: string; // «iPhone», «Mac · Chrome» — чтобы отличать устройства в списке
  addedAt: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string; // куда ведёт нажатие: путь панели («/runs») или https-ссылка
  tag?: string; // уведомление с тем же tag заменяет прежнее на устройстве
  badge?: number; // число на иконке приложения (0 — убрать); нет поля — число не меняется
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (s: string) => Buffer.from(s.trim(), "base64url");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- ключи VAPID ----

function publicFromPrivate(privateKey: string): Buffer | null {
  const d = unb64(privateKey);
  if (d.length < 30 || d.length > 32) return null;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.concat([Buffer.alloc(32 - d.length), d]));
    return ecdh.getPublicKey();
  } catch {
    return null;
  }
}

// Ключи из окружения и что с ними не так (для карточки). keys — null, пока есть проблемы.
export function vapidSetup(env: Readonly<Record<string, string | undefined>> = process.env): { keys: VapidKeys | null; problems: string[] } {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  const problems: string[] = [];
  const missing = [!publicKey && "VAPID_PUBLIC_KEY", !privateKey && "VAPID_PRIVATE_KEY", !subject && "VAPID_SUBJECT"].filter((n): n is string => Boolean(n));
  if (missing.length) problems.push(`Не задано: ${missing.join(", ")}.`);
  const pub = publicKey ? unb64(publicKey) : null;
  if (pub && (pub.length !== 65 || pub[0] !== 4)) problems.push("VAPID_PUBLIC_KEY не похож на ключ P-256 (87 символов, начинается с «B»).");
  else if (pub && privateKey) {
    const derived = publicFromPrivate(privateKey);
    if (!derived) problems.push("VAPID_PRIVATE_KEY не похож на ключ P-256 (43 символа base64url).");
    else if (!derived.equals(pub)) problems.push("VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY из разных пар — вставьте обе строки из одного запуска vapid-keys.");
  }
  // Apple без адреса для связи в sub отвечает 403 BadJwtToken.
  if (subject && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/i.test(subject)) problems.push("VAPID_SUBJECT — адрес вида mailto:вы@почта.ru или https://…");
  return { keys: problems.length || !pub ? null : { publicKey: b64(pub), privateKey, subject }, problems };
}

// Заголовок Authorization (RFC 8292): JWT ES256 для origin службы push + открытый ключ.
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const pub = unb64(keys.publicKey);
  const d = unb64(keys.privateKey);
  const jwk = { kty: "EC", crv: "P-256", d: b64(Buffer.concat([Buffer.alloc(32 - d.length), d])), x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) };
  const part = (o: object) => b64(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_JWT_SEC, sub: keys.subject })}`;
  // ES256 в JWT — подпись r‖s по 32 байта, а не DER.
  const signature = sign("sha256", Buffer.from(unsigned), { key: jwk, format: "jwk", dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64(signature)}, k=${b64(pub)}`;
}

// ---- шифрование (RFC 8291 поверх RFC 8188) ----

function deviceKeys(keys: PushKeys): { uaPublic: Buffer; authSecret: Buffer } {
  const uaPublic = unb64(keys.p256dh);
  const authSecret = unb64(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("ключ p256dh подписки — не точка P-256");
  if (authSecret.length !== 16) throw new Error("секрет auth подписки — не 16 байт");
  return { uaPublic, authSecret };
}

// Тело запроса к службе push: заголовок aes128gcm (соль, rs, открытый ключ сервера) и одна
// зашифрованная запись. fixed — только для проверки по примеру из RFC 8291 (приложение A).
export function encryptPayload(plaintext: Buffer, keys: PushKeys, fixed: { salt?: Buffer; serverPrivateKey?: Buffer } = {}): Buffer {
  if (plaintext.length > PUSH_MAX_PLAINTEXT) throw new Error(`сообщение длиннее ${PUSH_MAX_PLAINTEXT} байт`);
  const { uaPublic, authSecret } = deviceKeys(keys);
  // Новая пара ключей сервера на каждое сообщение — так требует RFC 8291.
  const ecdh = createECDH("prime256v1");
  if (fixed.serverPrivateKey) ecdh.setPrivateKey(fixed.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  let ecdhSecret: Buffer;
  try {
    ecdhSecret = ecdh.computeSecret(uaPublic);
  } catch {
    throw new Error("ключ p256dh подписки не лежит на кривой P-256");
  }
  const salt = fixed.salt ?? randomBytes(16);
  const hkdf = (ikm: Buffer, hkdfSalt: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync("sha256", ikm, hkdfSalt, info, length));
  const ikm = hkdf(ecdhSecret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 — разделитель последней (единственной) записи; выравнивания нулями не добавляем.
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}

// ---- подписки ----

// Куда панель согласна слать: службы push браузеров (Chrome и Android — FCM, Safari и iPhone —
// Apple, Firefox — Mozilla, Edge на Windows — WNS). Адрес приходит из браузера: без списка сервер
// можно было бы заставить постучаться куда угодно.
const PUSH_HOSTS = ["googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"];

export function isPushEndpoint(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export class PushInputError extends Error {}

const cleanLabel = (v: unknown) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "Устройство";

function cleanSub(v: unknown): PushSub | null {
  const j = (v ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; label?: unknown; addedAt?: unknown };
  const endpoint = typeof j.endpoint === "string" ? j.endpoint.trim() : "";
  const keys = { p256dh: typeof j.keys?.p256dh === "string" ? j.keys.p256dh.trim() : "", auth: typeof j.keys?.auth === "string" ? j.keys.auth.trim() : "" };
  if (!isPushEndpoint(endpoint)) return null;
  try {
    deviceKeys(keys);
  } catch {
    return null;
  }
  return { endpoint, keys, label: cleanLabel(j.label), addedAt: typeof j.addedAt === "string" ? j.addedAt : "" };
}

// Подписка из браузера (PushSubscription.toJSON()) — с понятной причиной отказа.
export function subscriptionFromClient(input: unknown, label: unknown, now = new Date()): PushSub {
  const endpoint = typeof (input as { endpoint?: unknown } | null)?.endpoint === "string" ? (input as { endpoint: string }).endpoint.trim() : "";
  if (!endpoint) throw new PushInputError("Браузер не дал адрес подписки — обновите страницу и попробуйте ещё раз.");
  if (!isPushEndpoint(endpoint)) {
    let host = "";
    try {
      host = new URL(endpoint).hostname;
    } catch {
      // адрес не URL
    }
    throw new PushInputError(`Служба уведомлений ${host || "этого браузера"} панели не знакома — включите уведомления в Safari, Chrome, Edge или Firefox.`);
  }
  const sub = cleanSub({ ...(input as object), label, addedAt: now.toISOString() });
  if (!sub) throw new PushInputError("В подписке браузера нет ключей шифрования — выключите и снова включите уведомления.");
  return sub;
}

export function parseSubs(raw: string | null): PushSub[] {
  let list: unknown;
  try {
    list = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: PushSub[] = [];
  for (const item of list) {
    const s = cleanSub(item);
    if (s && !out.some((o) => o.endpoint === s.endpoint)) out.push(s);
  }
  return out.slice(0, PUSH_MAX_DEVICES);
}

// Новое устройство — первым; то же устройство повторно — на место прежнего с прежней датой;
// одиннадцатое вытесняет самое давнее.
export function upsertSub(list: PushSub[], sub: PushSub): PushSub[] {
  const prev = list.find((s) => s.endpoint === sub.endpoint);
  return [{ ...sub, addedAt: prev?.addedAt || sub.addedAt }, ...list.filter((s) => s.endpoint !== sub.endpoint)].slice(0, PUSH_MAX_DEVICES);
}

// Короткий отпечаток адреса: карточка узнаёт «это устройство», не получая самих адресов.
export const deviceId = (endpoint: string) => createHash("sha256").update(endpoint).digest("base64url").slice(0, 16);

export interface PushStore {
  load(): Promise<PushSub[]>;
  save(list: PushSub[]): Promise<void>;
}

export const githubStore: PushStore = {
  load: async () => parseSubs(await getVariable(PUSH_SUBS_VAR)),
  save: (list) => setVariable(PUSH_SUBS_VAR, JSON.stringify(list)),
};

// ---- отправка ----

export interface SendOptions {
  ttl?: number;
  urgency?: Urgency;
  now?: number;
  fetch?: typeof fetch; // подмена в проверке без сети
}

export interface SendResult {
  endpoint: string;
  label: string;
  ok: boolean;
  status: number;
  gone: boolean; // 404/410: подписки больше нет — убрать из списка
  error: string | null;
}

function failureText(status: number, reason: string): string {
  const why = reason ? `: ${reason}` : "";
  if (status === 401 || status === 403) return `служба push не приняла ключ VAPID (${status}${why}) — проверьте VAPID_SUBJECT; если ключи меняли, выключите и снова включите уведомления на устройстве`;
  if (status === 413) return "сообщение слишком длинное (413)";
  if (status === 429) return "слишком часто (429) — служба push просит подождать";
  if (status >= 500) return `служба push недоступна (${status}) — попробуйте позже`;
  return `служба push ответила ${status}${why}`;
}

export async function sendPush(sub: PushSub, msg: PushMessage, keys: VapidKeys, opts: SendOptions = {}): Promise<SendResult> {
  const base = { endpoint: sub.endpoint, label: sub.label };
  let body: Buffer;
  try {
    const payload = { title: msg.title, body: msg.body, url: msg.url || "/", ...(msg.tag ? { tag: msg.tag } : {}), ...(msg.badge !== undefined ? { badge: msg.badge } : {}) };
    body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.keys);
  } catch (e) {
    return { ...base, ok: false, status: 0, gone: false, error: `не получилось зашифровать: ${errorText(e)}` };
  }
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys, opts.now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(Math.max(0, Math.round(opts.ttl ?? DEFAULT_TTL_SEC))),
        Urgency: opts.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    return { ...base, ok: false, status: 0, gone: false, error: `служба push не ответила (${errorText(e)})` };
  }
  if (res.ok) return { ...base, ok: true, status: res.status, gone: false, error: null };
  const gone = res.status === 404 || res.status === 410;
  let reason = "";
  try {
    reason = (await res.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  } catch {
    // тело не прочитать — хватит кода
  }
  return { ...base, ok: false, status: res.status, gone, error: gone ? "подписки больше нет — устройство убрано из списка" : failureText(res.status, reason) };
}

export interface NotifyOptions extends SendOptions {
  only?: string; // только это устройство (адрес подписки) — для «Проверить»
  store?: PushStore;
  env?: Readonly<Record<string, string | undefined>>;
}

export interface NotifyReport {
  devices: number; // устройств в списке
  sent: number;
  failed: number;
  removed: number; // подписок больше нет (404/410) — убраны из списка
  errors: string[]; // «iPhone: …»
  problem: string | null; // почему не отправляли вовсе: нет ключей, список не прочитан
}

// Разослать сообщение подписанным устройствам. Не бросает: всё, что пошло не так, — в отчёте,
// чтобы cron и workflow не падали из-за уведомлений.
export async function notifyDevices(msg: PushMessage, opts: NotifyOptions = {}): Promise<NotifyReport> {
  const empty = { devices: 0, sent: 0, failed: 0, removed: 0, errors: [] as string[] };
  const { keys, problems } = vapidSetup(opts.env);
  if (!keys) return { ...empty, problem: `Уведомления не настроены: ${problems.join(" ")}` };
  const store = opts.store ?? githubStore;
  let list: PushSub[];
  try {
    list = await store.load();
  } catch (e) {
    return { ...empty, problem: `Список устройств не прочитан: ${errorText(e)}` };
  }
  const targets = opts.only === undefined ? list : list.filter((s) => s.endpoint === opts.only);
  if (!targets.length) return { ...empty, devices: list.length, problem: opts.only === undefined ? null : "Это устройство не подписано — нажмите «Включить»." };
  const results = await Promise.all(targets.map((s) => sendPush(s, msg, keys, opts)));
  const gone = new Set(results.filter((r) => r.gone).map((r) => r.endpoint));
  let removed = 0;
  if (gone.size) {
    // Перечитываем список: пока шла рассылка, могли подписать новое устройство.
    try {
      const fresh = await store.load();
      const kept = fresh.filter((s) => !gone.has(s.endpoint));
      if (kept.length < fresh.length) await store.save(kept);
      removed = fresh.length - kept.length;
    } catch {
      // не страшно: в следующий раз служба push снова ответит 410
    }
  }
  return {
    devices: list.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    removed,
    errors: results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`),
    problem: null,
  };
}

// ---- сообщение от машин (/api/notify) ----

function clip(v: unknown, max: number): string {
  const s = (typeof v === "string" ? v : "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Путь панели («/runs») или https-ссылка; остальное — на главную.
export function safeUrl(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 500) return "/";
  if (s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\")) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.href : "/";
  } catch {
    return "/";
  }
}

export function messageFromInput(input: unknown): PushMessage | null {
  const j = (input ?? {}) as { title?: unknown; body?: unknown; url?: unknown };
  const title = clip(j.title, 100);
  if (!title) return null;
  return { title, body: clip(j.body, 400), url: safeUrl(j.url) };
}
