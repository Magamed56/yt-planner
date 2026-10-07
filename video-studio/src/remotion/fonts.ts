import React, { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
// Шрифты лежат в репозитории (OFL, урезаны до латиницы+кириллицы, woff2) и
// импортируются через webpack — URL попадает прямо в бандл. Так они работают
// одинаково в Studio без publicDir, в рендере на GitHub Actions и на ПК без
// интернета. @remotion/google-fonts тянет файлы с fonts.gstatic.com из
// браузера рендера — в песочнице и офлайн это падает, поэтому не используем.
import montserratUrl from "../../assets/fonts/Montserrat.woff2";
import manropeUrl from "../../assets/fonts/Manrope.woff2";
import unboundedUrl from "../../assets/fonts/Unbounded.woff2";

// Уникальные имена семейств, чтобы случайно не подхватить системный шрифт
// с тем же именем и другими метриками (замер текста тогда разъедется).
export const FONT_DISPLAY = "'VS Display', 'Montserrat', 'Arial', sans-serif"; // заголовки, субтитры
export const FONT_BODY = "'VS Body', 'Manrope', 'Arial', sans-serif"; // подписи, пункты
export const FONT_NUMBER = "'VS Number', 'Unbounded', 'Arial Black', sans-serif"; // крупные цифры

const FACES: { family: string; url: string; weight: string }[] = [
  { family: "VS Display", url: montserratUrl, weight: "100 900" },
  { family: "VS Body", url: manropeUrl, weight: "200 800" },
  { family: "VS Number", url: unboundedUrl, weight: "200 900" },
];

let loading: Promise<void> | null = null;
let loaded = false;

export function loadFonts(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all(
    FACES.map(async (f) => {
      const face = new FontFace(f.family, `url(${f.url}) format("woff2")`, { weight: f.weight, style: "normal" });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => {
      loaded = true;
    })
    .catch((err: unknown) => {
      // Без своих шрифтов ролик всё равно рендерится системным sans-serif —
      // лучше некрасиво, чем упавший рендер посреди ночи в CI.
      loaded = true;
      console.warn(`[шрифты] не удалось загрузить, используем системные: ${String(err)}`);
    });
  return loading;
}

// Пока шрифты не готовы — дети не монтируются вовсе. Это важно: KineticText
// меряет слова через measureText при рендере, и замер системным шрифтом
// закэшировался бы навсегда.
export const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(loaded);
  const [handle] = useState(() => (loaded ? null : delayRender("Загрузка шрифтов", { timeoutInMilliseconds: 30000 })));
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadFonts().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);
  useEffect(() => {
    if (ready && handle !== null) continueRender(handle);
  }, [ready, handle]);
  return ready ? React.createElement(React.Fragment, null, children) : null;
};
