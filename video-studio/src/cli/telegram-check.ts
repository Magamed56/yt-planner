// Проверка настроек Telegram перед первой отправкой: токен бота, канал и права бота в нём.
// Без TELEGRAM_CHAT_ID показывает каналы и группы, куда бота недавно добавили, — с их id.
//   npm run telegram-check
// Логика — checkTelegram в src/pipeline/telegram.ts (проверяется в src/dev/telegram-test.ts).
import { parseArgs } from "node:util";
import { checkTelegram, normalizeChatId, telegramEnvHelp } from "../pipeline/telegram";
import { UserError, argsError, fail, loadEnv } from "./common";

const HELP = `Проверка бота Telegram для кросспостинга роликов.

  npm run telegram-check

Берёт TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID из .env (или окружения).
  - Задан только токен — покажет каналы, куда бота добавили за последние сутки, и их id.
  - Заданы оба — проверит, что бот видит канал и может в нём публиковать.
Пошагово: docs/telegram-setup.md.
`;

async function main() {
  loadEnv();
  let help = false;
  try {
    help = parseArgs({ args: process.argv.slice(2), options: { help: { type: "boolean", short: "h", default: false } }, strict: true }).values.help === true;
  } catch (e) {
    throw new UserError(`${argsError(e)}\n\n${HELP}`);
  }
  if (help) {
    console.log(HELP);
    process.exit(0);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (!token) throw new UserError(`Не задан TELEGRAM_BOT_TOKEN.\n${telegramEnvHelp()}`);
  const rawChat = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  const chatId = rawChat ? normalizeChatId(rawChat) : null;
  if (rawChat && !chatId) throw new UserError(`TELEGRAM_CHAT_ID="${rawChat}" — не похоже на id канала: нужен -100… или @имя публичного канала. Уберите его из .env и запустите проверку снова — она покажет id.`);

  console.log("video-studio · проверка Telegram");
  const r = await checkTelegram({ token, chatId });
  if (r.bot) console.log(`  ✔ бот: @${r.bot.username ?? "?"} (${r.bot.name || "без имени"})`);
  if (!chatId && r.bot) {
    if (r.foundChats.length) {
      console.log("\n  TELEGRAM_CHAT_ID не задан. Бот видел эти каналы и группы (события за последние сутки):");
      for (const c of r.foundChats) console.log(`    ${c.id}  ${c.type === "channel" ? "канал" : c.type}  «${c.title ?? "без названия"}»`);
      console.log("\n  Впишите id нужного канала в .env (TELEGRAM_CHAT_ID=-100…) и в секреты GitHub, затем запустите проверку снова.");
    } else if (!r.problems.length) {
      console.log(
        "\n  TELEGRAM_CHAT_ID не задан, а событий от каналов нет.\n" +
          "  Добавьте бота администратором канала (или опубликуйте в канале любое сообщение, когда бот уже там) и запустите проверку снова.\n" +
          "  У публичного канала можно сразу указать TELEGRAM_CHAT_ID=@имя_канала.",
      );
    }
  }
  if (r.chat) console.log(`  ✔ ${r.chat.type === "channel" ? "канал" : r.chat.type}: «${r.chat.title ?? "без названия"}», id ${r.chat.id}${r.chat.username ? ` (@${r.chat.username})` : ""}`);
  if (r.member?.canPost) console.log(`  ✔ права: ${r.member.status === "administrator" ? "администратор, может публиковать" : r.member.status}`);
  if (r.problems.length) {
    for (const p of r.problems) console.error(`  ✖ ${p}`);
    process.exit(1);
  }
  if (r.chat && r.member?.canPost) {
    if (rawChat !== r.chat.id && !rawChat.startsWith("@")) console.log(`  подсказка: точный id канала — ${r.chat.id}`);
    console.log("\n✔ Всё готово. Проверочная отправка: npm run upload -- out/<папка ролика> --to telegram");
  }
}

process.on("unhandledRejection", (e) => fail(e));
main()
  .then(() => process.exit(0))
  .catch(fail);
