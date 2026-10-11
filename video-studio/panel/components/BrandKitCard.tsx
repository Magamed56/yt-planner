"use client";
// «Оформление канала» на странице канала другого языка: превью баннера и аватара, оригиналы на
// телефон тем же FilesSaver, что и ролики (на iPhone — «Сохранить в Фото», без сжатия), описание и
// ключевые слова в буфер, короткие шаги с телефона. Тексты — из brand/<язык>/README.md, картинки —
// через /api/brand (репозиторий приватный). Свёрнут ли блок — запоминается на этом устройстве.
import { useLayoutEffect, useState } from "react";
import { charCount, DESCRIPTION_MAX, type BrandKit } from "@/lib/brand-kit";
import type { LangChannel } from "@/lib/lang-channels";
import { plural } from "@/lib/stages";
import FilesSaver from "./FilesSaver";
import s from "./lang.module.css";

const OPEN_KEY = "panel.brand.open";

type Copy = (key: string, what: string, text: string) => void;

export default function BrandKitCard({
  kit,
  channel,
  mainChannel,
  onCopy,
  manual,
}: {
  kit: BrandKit;
  channel: LangChannel;
  mainChannel: string;
  onCopy: Copy;
  manual: { what: string; text: string } | null;
}) {
  // Сервер рисует открытым; свернули раньше — закроем после гидрации (разметка не расходится).
  // useLayoutEffect — до первой отрисовки: при переходе по меню блок не мелькнёт раскрытым.
  const [open, setOpen] = useState(true);
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
    } catch {
      // приватный режим — блок просто открыт
    }
  }, []);
  function toggle(next: boolean) {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // не запомним — не страшно
    }
  }

  const name = channel.name;
  const banner = kit.youtube.find((f) => f.path === "banner-youtube.png");
  const avatar = kit.youtube.find((f) => f.path === "avatar-youtube.png");
  const { description, keywords, post } = kit.texts;
  const key = name; // для тоста «Скопировано: описание канала (Gist in a Minute)»
  const ig = kit.instagram.length;

  return (
    <details
      className={`card ${s.brand}`}
      open={open}
      // toggle шлёт и сам браузер, когда open ставит React или разбор HTML, — не всегда до чтения
      // localStorage, и «1» затёрло бы сохранённое «свёрнут». Запоминаем только нажатие: после
      // него DOM расходится с состоянием.
      onToggle={(e) => {
        if (e.currentTarget.open !== open) toggle(e.currentTarget.open);
      }}
    >
      <summary>
        <span className={s.brandTitle}>🎨 Оформление канала</span>{" "}
        <span className={`small muted ${s.brandHint}`}>баннер, аватар, описание</span>
      </summary>

      <div className={s.brandBody}>
        <div className={s.preview}>
          {banner && (
            <div className={s.banner}>
              <img src={banner.src} alt={`Баннер «${name}»`} loading="lazy" decoding="async" />
              <span className={s.safe} aria-hidden />
            </div>
          )}
          <div className={`${s.identity}${banner ? ` ${s.over}` : ""}`}>
            {avatar && <img className={s.avatar} src={avatar.src} alt={`Аватар «${name}»`} loading="lazy" decoding="async" />}
            <div className={s.who}>
              <b>{name}</b>
              {channel.handle && <span className="small muted">@{channel.handle}</span>}
            </div>
            {channel.youtube && (
              <a className="btn small" href={channel.youtube} target="_blank" rel="noreferrer">
                Канал ↗
              </a>
            )}
          </div>
          {banner && <p className="small muted">Пунктир — что видно на телефоне; иконки по бокам — только на компьютере и ТВ.</p>}
        </div>

        <div className="notice warn">
          <span>
            <b>Сначала переключитесь на «{name}».</b> YouTube → «Вы» → имя канала вверху (или «Сменить аккаунт») → {name}. Иначе баннер и описание
            встанут на «{mainChannel}».
          </span>
        </div>

        <div className={s.group}>
          <span className={s.groupLabel}>Оригиналы — без сжатия</span>
          <div className={s.kit}>
            {kit.youtube.map((f) => (
              <FilesSaver key={f.key} files={[f]} label={f.label} compact subtle />
            ))}
          </div>
          <span className="small muted">{kit.youtube.map((f) => `${f.label.toLowerCase()} ${f.width}×${f.height}`).join(" · ")}</span>
        </div>

        <div className={s.group}>
          <span className={s.groupLabel}>📋 Тексты канала</span>
          {description || keywords ? (
            <div className={`${s.kit} ${s.two}`}>
              {description && (
                <button className="btn small" onClick={() => onCopy(key, "описание канала", description)}>
                  📋 Скопировать описание
                </button>
              )}
              {keywords && (
                <button className="btn small" onClick={() => onCopy(key, "ключевые слова", keywords)}>
                  📋 Скопировать ключевые слова
                </button>
              )}
            </div>
          ) : (
            <p className="small flag">
              Описание и ключевые слова не прочитались из README кита — обновите страницу{kit.readmeUrl ? " или откройте инструкцию ниже" : ""}.
            </p>
          )}
          {manual && (
            <div className={s.manual}>
              <p className="small flag">Не скопировалось ({manual.what}) — выделите текст и скопируйте:</p>
              <div className="caption">{manual.text}</div>
            </div>
          )}
          {(description || keywords) && (
            <details className={s.more}>
              <summary>Показать тексты</summary>
              <dl className={s.texts}>
                {description && (
                  <>
                    <dt>
                      Описание · {charCount(description)} из {DESCRIPTION_MAX} знаков
                    </dt>
                    <dd className="caption">{description}</dd>
                  </>
                )}
                {keywords && (
                  <>
                    <dt>Ключевые слова (только Studio на компьютере)</dt>
                    <dd>{keywords}</dd>
                  </>
                )}
              </dl>
            </details>
          )}
        </div>

        <div className={s.group}>
          <span className={s.groupLabel}>С телефона — приложение YouTube</span>
          <ol className="steps">
            <li>«Баннер» и «Аватар» выше → на iPhone в меню «Сохранить изображение»: картинки лягут в «Фото» как есть.</li>
            <li>Проверьте, что открыт «{name}» → «Вы» → «Перейти на канал» → ✏️ «Изменить канал».</li>
            <li>Баннер: 📷 на баннере → выберите его из «Фото» → кадр не двигайте → «Сохранить».</li>
            <li>Аватар: 📷 на круглом фото → аватар → рамку не двигайте → «Сохранить».</li>
            <li>«Описание» → вставьте («Скопировать описание») → «Сохранить».</li>
          </ol>
          <p className="small muted">
            Водяной знак и ключевые слова с телефона не ставятся — только studio.youtube.com на компьютере: «Настройка канала» → «Профиль» →
            «Водяной знак» (показ — «Всё видео»); «Настройки» → «Канал» → «Основная информация» → «Ключевые слова». Баннер и аватар
            обновляются за несколько минут, иногда до суток.
          </p>
          <div className="btn-row">
            <a className="btn small ghost" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
              YouTube Studio ↗
            </a>
            {kit.readmeUrl && (
              <a className="btn small ghost" href={kit.readmeUrl} target="_blank" rel="noreferrer">
                Вся инструкция ↗
              </a>
            )}
          </div>
        </div>

        {ig > 0 && (
          <details className={s.more}>
            <summary>
              Instagram — когда заведёте аккаунт ({ig} {plural(ig, "картинка", "картинки", "картинок")})
            </summary>
            <div className={s.igBody}>
              <p className="small muted">Аватар 1080×1080, обложки «Актуального» по рубрикам, пост-знакомство 4:5. Куда что ставить — в инструкции.</p>
              <div className={`${s.kit} ${s.two}`}>
                {post && (
                  <button className="btn small" onClick={() => onCopy(key, "подпись к посту", post)}>
                    📋 Подпись к посту
                  </button>
                )}
                {/* Последним: под кнопкой FilesSaver раскрывает список «По одному файлу». */}
                <FilesSaver files={kit.instagram} label="Все картинки" compact subtle />
              </div>
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
