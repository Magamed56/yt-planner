// Разовая настройка загрузки на YouTube: вход в Google через браузер
// (OAuth с возвратом на 127.0.0.1) → печать YT_REFRESH_TOKEN, который
// кладётся в .env и в секреты GitHub. Запускать на своём ПК:
//   npm run youtube-auth            (YT_CLIENT_ID и YT_CLIENT_SECRET — в .env)
//   npm run youtube-auth -- --save  (ещё и записать токен в .env)
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";
import { YT_SCOPES } from "../pipeline/youtube";
import { ROOT, UserError, fail, loadEnv } from "./common";

const TIMEOUT_MS = 5 * 60_000;

function openBrowser(url: string): void {
  try {
    // rundll32 на Windows: через cmd «&» в адресе разорвал бы команду.
    const [cmd, args] =
      process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // нет браузера (сервер, CI) — ссылка напечатана, откроют руками
  }
}

function saveToEnv(token: string): string {
  const file = path.join(ROOT, ".env");
  const line = `YT_REFRESH_TOKEN=${token}`;
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = /^YT_REFRESH_TOKEN=.*$/m.test(text) ? text.replace(/^YT_REFRESH_TOKEN=.*$/m, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.writeFileSync(file, next);
  return file;
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { save: { type: "boolean", default: false }, "no-open": { type: "boolean", default: false } },
    strict: true,
  });
  const clientId = process.env.YT_CLIENT_ID?.trim();
  const clientSecret = process.env.YT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new UserError(
      "Сначала задайте YT_CLIENT_ID и YT_CLIENT_SECRET в .env.\n" +
        "  Google Cloud Console → APIs & Services → включить «YouTube Data API v3» →\n" +
        "  OAuth consent screen (External) → Credentials → Create credentials → OAuth client ID → «Desktop app».",
    );
  }

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { codeVerifier, codeChallenge } = await oauth2.generateCodeVerifierAsync();
  const state = crypto.randomBytes(16).toString("hex");
  type AuthUrlOpts = NonNullable<Parameters<typeof oauth2.generateAuthUrl>[0]>;
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // иначе при повторном входе Google не выдаёт refresh token
    scope: YT_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as AuthUrlOpts["code_challenge_method"],
  });

  console.log("Откройте ссылку и войдите в аккаунт Google, к которому привязан канал:\n");
  console.log(url + "\n");
  console.log("Google может предупредить «приложение не проверено» — это ваше собственное приложение: «Дополнительно» → «Перейти».");
  if (!values["no-open"]) openBrowser(url);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UserError("Не дождался входа за 5 минут. Запустите npm run youtube-auth ещё раз.")), TIMEOUT_MS);
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirectUri);
      if (u.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const page = (msg: string) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>video-studio</title><body style="font:18px system-ui;padding:40px">${msg}</body>`);
      };
      const err = u.searchParams.get("error");
      if (err) {
        page("Доступ не выдан. Можно закрыть вкладку.");
        clearTimeout(timer);
        reject(new UserError(`Google вернул ошибку: ${err}`));
        return;
      }
      if (u.searchParams.get("state") !== state) {
        page("Неверный state — запустите npm run youtube-auth заново.");
        return;
      }
      page("Готово ✔ Вернитесь в терминал — токен напечатан там. Вкладку можно закрыть.");
      clearTimeout(timer);
      resolve(u.searchParams.get("code") ?? "");
    });
  }).finally(() => server.close());

  const { tokens } = await oauth2.getToken({ code, codeVerifier, redirect_uri: redirectUri }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid_client|unauthorized_client/i.test(msg)) throw new UserError("Google не принял YT_CLIENT_ID / YT_CLIENT_SECRET — скопируйте их заново (Credentials → OAuth client «Desktop app»).");
    if (/redirect_uri_mismatch/i.test(msg)) throw new UserError("redirect_uri_mismatch: OAuth-клиент должен быть типа «Desktop app», а не «Web application».");
    if (/invalid_grant/i.test(msg)) throw new UserError("Код входа устарел или уже использован — запустите npm run youtube-auth ещё раз.");
    throw new UserError(`Не удалось обменять код на токен: ${msg}`);
  });
  if (!tokens.refresh_token) {
    throw new UserError(
      "Google не выдал refresh token. Отзовите доступ приложения на https://myaccount.google.com/permissions и запустите npm run youtube-auth ещё раз.",
    );
  }
  console.log("\n✔ Готово. Добавьте в .env и в GitHub → Settings → Secrets and variables → Actions → New repository secret:\n");
  console.log(`YT_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  if (values.save) console.log(`Записал в ${saveToEnv(tokens.refresh_token)}`);
  console.log("Важно: в OAuth consent screen переведите приложение в «In production» — в режиме «Testing» токен перестаёт работать через 7 дней.");
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
