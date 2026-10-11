// Буфер обмена для кнопок «Скопировать» (страница English, лист ролика на «Доске»). Только браузер.
// Текст в буфер. Готовый — сразу. Тот, что ещё грузится с сервера (подпись Instagram), — через
// ClipboardItem с обещанием: Safari на iPhone пишет в буфер только сразу после касания и иначе
// отказал бы, пока ждём ответ. Не вышло — false: покажем текст, чтобы скопировать руками.
export async function writeClipboard(text: string | Promise<string>): Promise<boolean> {
  try {
    if (typeof text === "string") {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
        blob.catch(() => {}); // ошибку сервера покажет вызывающий
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
        return true;
      } catch {
        // браузер не принял обещание — ниже обычным способом
      }
    }
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}
