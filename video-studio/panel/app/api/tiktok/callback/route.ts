// Возврат из TikTok после «Разрешить». Открыт без входа (proxy.ts): панель со значка на iPhone
// открывает TikTok в отдельном окне без своих cookie. Защита — подписанный state (lib/tiktok.ts).
import { connectWithCode, stateValid } from "@/lib/tiktok";

export const maxDuration = 30;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Простая страница в цветах панели: окно входа могло открыться отдельно — оттуда проще вернуться.
function page(ok: boolean, text: string): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TikTok</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0a22;color:#fff;font:16px/1.5 system-ui,sans-serif}
main{max-width:420px;padding:24px;text-align:center}b{display:block;font-size:22px;margin-bottom:8px;color:${ok ? "#3fcf8e" : "#ff6b81"}}
a{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:999px;background:#ffd23f;color:#0b0b1a;font-weight:800;text-decoration:none}</style></head>
<body><main><b>${ok ? "TikTok подключён" : "TikTok не подключён"}</b>${esc(text)}<br><a href="/tiktok">Открыть TikTok в панели</a></main></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams;
  if (q.get("error")) return page(false, `TikTok ответил: ${q.get("error_description") || q.get("error")}. Попробуйте ещё раз.`);
  if (!stateValid(q.get("state"))) return page(false, "Ссылка устарела или подделана. Нажмите «Подключить TikTok» в панели ещё раз.");
  const code = q.get("code");
  if (!code) return page(false, "TikTok не передал код входа. Попробуйте ещё раз.");
  try {
    await connectWithCode(code, url.origin);
    return page(true, "Статистика TikTok появится в панели на странице «TikTok». Это окно можно закрыть.");
  } catch (e) {
    return page(false, e instanceof Error ? e.message : String(e));
  }
}
