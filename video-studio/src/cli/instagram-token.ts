// Токен Instagram (вариант «Facebook Login for Business»): проверить, продлить,
// получить бессрочный токен страницы и узнать IG_USER_ID. Запускать на своём ПК:
//   npm run instagram-token                       проверить IG_ACCESS_TOKEN: срок, права, IG_USER_ID
//   npm run instagram-token -- --exchange         короткий/старый токен → новый на ~60 дней (нужны IG_APP_ID, IG_APP_SECRET)
//   npm run instagram-token -- --exchange --page  ещё и токен страницы Facebook — он не истекает
//   npm run instagram-token -- --token EAA… --exchange --page --save   токен из Graph API Explorer → в .env
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { IG_DEFAULT_HOST, IG_DEFAULT_VERSION, explainInstagramError } from "../pipeline/instagram";
import { ROOT, UserError, argsError, fail, loadEnv, rel } from "./common";

const HELP = `Токен Instagram: проверка, продление, IG_USER_ID.

  npm run instagram-token                         проверить IG_ACCESS_TOKEN (срок, права, IG_USER_ID)
  npm run instagram-token -- --exchange           продлить: новый токен на ~60 дней
  npm run instagram-token -- --exchange --page    получить токен страницы — он не истекает (рекомендуется)
  npm run instagram-token -- --token EAA… …       взять токен из аргумента, а не из .env
  … --save                                        записать IG_ACCESS_TOKEN (и IG_USER_ID) в .env

Для --exchange нужны IG_APP_ID и IG_APP_SECRET (developers.facebook.com → ваше приложение →
Настройки приложения → Основное). Подробно: docs/instagram-setup.md.
`;

interface Accounts {
  data?: { id: string; name?: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }[];
}

const host = () => (process.env.IG_API_HOST?.trim() || IG_DEFAULT_HOST).replace(/^https?:\/\//, "").replace(/\/+$/, "");
const version = () => {
  const v = process.env.IG_API_VERSION?.trim() || IG_DEFAULT_VERSION;
  return /^v?\d+\.\d+$/.test(v) ? (v.startsWith("v") ? v : `v${v}`) : IG_DEFAULT_VERSION;
};

async function get<T>(base: string, pathname: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${base}/${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new UserError(`Нет связи с ${url.host} (${e instanceof Error ? e.message : String(e)}). Проверьте интернет и повторите.`);
  }
  const text = await res.text();
  let json: { error?: { message?: string; code?: number; error_subcode?: number } } & Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    // не JSON
  }
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new UserError(`Meta: ${explainInstagramError(res.status, e.code ?? null, e.error_subcode ?? null, e.message ?? text.slice(0, 200))}`);
  }
  return json as T;
}

function saveToEnv(values: Record<string, string>): string {
  const file = path.join(ROOT, ".env");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  fs.writeFileSync(file, text);
  return file;
}

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК";

async function main() {
  loadEnv();
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: process.argv.slice(2),
      options: {
        token: { type: "string" },
        exchange: { type: "boolean", default: false },
        page: { type: "boolean", default: false },
        save: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    }).values;
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  let token = (typeof values.token === "string" ? values.token : process.env.IG_ACCESS_TOKEN ?? "").trim();
  if (!token) throw new UserError(`Нет токена: задайте IG_ACCESS_TOKEN в .env или передайте --token EAA…\n\n${HELP}`);
  const toSave: Record<string, string> = {};

  // Токен «Instagram Login» (IG…): у него своё продление, но для загрузки файла он не подходит.
  if (/^IG/i.test(token)) {
    console.log("⚠ Это токен «Instagram API with Instagram Login» (начинается с IG). Для публикации файла без публичной ссылки нужен");
    console.log("  токен «Facebook Login for Business» (EAA…) — см. docs/instagram-setup.md. Продлеваю как есть.");
    if (values.exchange) {
      const r = await get<{ access_token?: string; expires_in?: number }>("https://graph.instagram.com", "refresh_access_token", { grant_type: "ig_refresh_token", access_token: token });
      if (!r.access_token) throw new UserError("Meta не вернула новый токен.");
      console.log(`\n✔ Новый токен (действует ~${Math.round((r.expires_in ?? 5_184_000) / 86400)} дн.):\n\nIG_ACCESS_TOKEN=${r.access_token}\n`);
      if (values.save) console.log(`Записал в ${rel(saveToEnv({ IG_ACCESS_TOKEN: r.access_token }))}`);
    }
    return;
  }

  const base = `https://${host()}/${version()}`;
  const appId = process.env.IG_APP_ID?.trim();
  const appSecret = process.env.IG_APP_SECRET?.trim();

  if (values.exchange) {
    if (!appId || !appSecret) throw new UserError("Для --exchange нужны IG_APP_ID и IG_APP_SECRET в .env (developers.facebook.com → приложение → Настройки приложения → Основное).");
    const r = await get<{ access_token?: string; expires_in?: number }>(base, "oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: token,
    });
    if (!r.access_token) throw new UserError("Meta не вернула новый токен.");
    token = r.access_token;
    const days = r.expires_in ? Math.round(r.expires_in / 86400) : 60;
    console.log(`✔ Долгоживущий токен пользователя получен (действует ~${days} дн.).`);
    toSave.IG_ACCESS_TOKEN = token;
  }

  // Проверка: тип, срок, права (debug_token). Токеном приложения — если есть секрет.
  try {
    const d = await get<{ data?: { type?: string; is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[] } }>(base, "debug_token", {
      input_token: token,
      access_token: appId && appSecret ? `${appId}|${appSecret}` : token,
    });
    const info = d.data ?? {};
    console.log(`\nТокен: ${info.type ?? "?"}, ${info.is_valid === false ? "НЕДЕЙСТВИТЕЛЕН" : "действителен"}`);
    console.log(`  истекает: ${info.expires_at ? fmtDate(info.expires_at) : "никогда"}`);
    if (info.data_access_expires_at) console.log(`  доступ к данным до: ${fmtDate(info.data_access_expires_at)} (продлевается при каждом обновлении токена)`);
    const need = ["instagram_basic", "instagram_content_publish", "pages_read_engagement"];
    const scopes = info.scopes ?? [];
    if (scopes.length) {
      const missing = need.filter((s) => !scopes.includes(s));
      console.log(`  права: ${scopes.join(", ")}`);
      if (missing.length) console.log(`  ⚠ не хватает: ${missing.join(", ")} — выпустите токен заново с этими галочками.`);
    }
  } catch (e) {
    console.log(`\n(срок токена проверить не удалось: ${e instanceof Error ? e.message : String(e)})`);
  }

  // IG_USER_ID и токены страниц. У токена страницы /me — это сама страница.
  let pages: NonNullable<Accounts["data"]> = [];
  try {
    pages = (await get<Accounts>(base, "me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50" })).data ?? [];
  } catch {
    const me = await get<{ id: string; name?: string; instagram_business_account?: { id: string; username?: string } }>(base, "me", { fields: "id,name,instagram_business_account{id,username}" });
    pages = [{ id: me.id, name: me.name, instagram_business_account: me.instagram_business_account }];
  }
  const linked = pages.filter((p) => p.instagram_business_account?.id);
  if (!linked.length) {
    throw new UserError(
      "Ни одна страница Facebook этого токена не связана с профессиональным аккаунтом Instagram.\n" +
        "  Instagram → Настройки → «Тип аккаунта и инструменты» → профессиональный (Бизнес), затем привяжите страницу Facebook (docs/instagram-setup.md, шаг 1).",
    );
  }
  console.log("\nInstagram-аккаунты:");
  for (const p of linked) console.log(`  @${p.instagram_business_account!.username ?? "?"} — IG_USER_ID=${p.instagram_business_account!.id} (страница «${p.name ?? p.id}»)`);
  const wanted = process.env.IG_USER_ID?.trim();
  const target = linked.find((p) => p.instagram_business_account!.id === wanted) ?? (linked.length === 1 ? linked[0] : undefined);
  if (target) toSave.IG_USER_ID = target.instagram_business_account!.id;
  else console.log("  Несколько аккаунтов — впишите нужный IG_USER_ID в .env и запустите снова.");

  if (values.page) {
    if (!target?.access_token) throw new UserError("Токен страницы получить не удалось: нужен токен ПОЛЬЗОВАТЕЛЯ (из Graph API Explorer) с pages_show_list, и одна выбранная страница (IG_USER_ID).");
    toSave.IG_ACCESS_TOKEN = target.access_token;
    console.log(`\n✔ Токен страницы «${target.name ?? target.id}»: получен из долгоживущего токена пользователя — он не истекает`);
    console.log("  (перестанет работать, только если сменить пароль Facebook, убрать права приложения или вас из админов страницы).");
  }

  if (toSave.IG_ACCESS_TOKEN || toSave.IG_USER_ID) {
    console.log("\nДобавьте в .env и в GitHub → Settings → Secrets and variables → Actions → New repository secret:\n");
    for (const [k, v] of Object.entries(toSave)) console.log(`${k}=${v}`);
    console.log("");
    if (values.save) console.log(`Записал в ${rel(saveToEnv(toSave))}`);
  }
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
