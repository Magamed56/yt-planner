// Новая пара ключей VAPID для уведомлений панели и ключ для /api/notify — строки для Vercel →
// Settings → Environment Variables. Ключи только печатаются (нигде не сохраняются): закрытый —
// в Vercel, не в git и не в чаты.
// Запуск из папки video-studio: npx tsx panel/scripts/vapid-keys.ts [ваша@почта]
import { generateKeyPairSync, randomBytes } from "node:crypto";

const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
if (!jwk.d || !jwk.x || !jwk.y) throw new Error("Node не отдал ключ P-256 в JWK — обновите Node до 18+.");
// Открытый ключ VAPID — несжатая точка: 0x04 ‖ x ‖ y (65 байт), закрытый — 32 байта d; всё в base64url.
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
const email = process.argv[2]?.trim();
const subject = email && /^[^\s@]+@[^\s@]+$/.test(email) ? `mailto:${email}` : "mailto:вы@почта.ru";

console.log(`# Уведомления панели → Vercel → Settings → Environment Variables (Production), затем Redeploy.
# VAPID_SUBJECT — ваша почта: без неё Apple не примет уведомления.
# PANEL_NOTIFY_SECRET — ещё и в секреты GitHub Actions, если workflow будет слать «видео готово».
# Новая пара ключей отключает уже подписанные устройства — на каждом нажмите «Включить» заново.
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${jwk.d}
VAPID_SUBJECT=${subject}
PANEL_NOTIFY_SECRET=${randomBytes(32).toString("base64url")}`);
