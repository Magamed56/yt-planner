// Имя папки запуска / файла черновика из заголовка: кириллица → латиница.
// Только [a-z0-9-] — такие имена без сюрпризов работают на Windows, в URL
// релизов GitHub и в тегах git.

const MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
  // украинские, белорусские, кыргызские и казахские буквы
  і: "i", ї: "yi", є: "ye", ґ: "g", ў: "u", ң: "ng", ө: "o", ү: "u", қ: "q", ғ: "gh",
  ә: "a", һ: "h", ұ: "u",
};

export function transliterate(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) out += MAP[ch] ?? ch;
  // Латиница с диакритикой (é, ü) → без неё.
  return out.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function slugify(text: string, maxLen = 60): string {
  const base = transliterate(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return `video-${new Date().toISOString().slice(0, 10)}`;
  if (base.length <= maxLen) return base;
  // Режем по границе слова, чтобы не было «pochemu-ty-zab».
  const cut = base.slice(0, maxLen + 1);
  const i = cut.lastIndexOf("-");
  return (i > maxLen * 0.5 ? cut.slice(0, i) : base.slice(0, maxLen)).replace(/-+$/, "");
}
