# Бренд-кит «Gist in a Minute» (английский канал)

Английский канал — «брат» «Суть за минуту»: тот же ночной фон (тема `midnight`), жёлто-оранжевый
акцент, шрифт Montserrat и тот же знак — кольцо-секундомер с искрой внутри. Меняются только
надписи: название, слоган «Complex made simple. Every day», рубрики, «2 new videos a day» и ник
**@GistinaMinute**.

Канал: https://www.youtube.com/@GistinaMinute. Тексты на картинках берутся из
`channels/en.json`. Поменяли там — перерисуйте (см. «Как перерисовать» внизу).

## Что куда загружать

| Файл | Размер | Куда |
|---|---|---|
| `avatar-youtube.png` | 800×800 | YouTube → фото профиля |
| `banner-youtube.png` | 2560×1440 | YouTube → баннер |
| `watermark-youtube.png` | 150×150, прозрачный фон | YouTube → водяной знак |
| `avatar-instagram.png` | 1080×1080 | Instagram → фото профиля (когда заведёте английский Instagram) |
| `highlights/*.png` (8 шт.) | 1080×1920 | Instagram → обложки «Актуального» |
| `instagram-post-intro.png` | 1080×1350 (4:5) | Instagram → первый пост-знакомство |
| `banner-safe-preview.png` | 2560×1440 | **не загружать**: проверка, что видно на каком экране |
| `avatar-preview.png` | 1600×760 | **не загружать**: аватар и водяной знак в реальных размерах |

Подписи на листах `banner-safe-preview.png` и `avatar-preview.png` по-русски: их видите только вы.

## Сначала переключитесь на английский канал

Если «Gist in a Minute» живёт в том же Google-аккаунте, что и «Суть за минуту», легко по ошибке
поменять картинки русскому каналу. Перед каждым шагом проверьте, какой канал открыт.

- **Телефон, приложение YouTube:** вкладка **«Вы»** → нажмите на имя канала вверху (или
  **«Сменить аккаунт»**) → выберите **Gist in a Minute**.
- **Компьютер, studio.youtube.com:** аватар справа вверху → **«Сменить аккаунт»** →
  **Gist in a Minute**. Название канала видно слева над меню.

## YouTube с телефона (приложение YouTube)

1. Вкладка **«Вы»** → нажмите на название канала (**«Перейти на канал»**) → значок
   **карандаша** («Изменить канал»).
2. **Баннер:** значок **камеры** на баннере → выберите `banner-youtube.png` → в окне кадрирования
   ничего не двигайте → подтвердите (**«Сохранить»**).
3. **Аватар:** значок **камеры** на круглом фото → `avatar-youtube.png` → рамку не двигайте →
   **«Сохранить»**.
4. Там же можно вставить **описание** (поле «Описание», текст — ниже). Ключевые слова и водяной знак
   с телефона не ставятся: это только в Studio на компьютере.

Чтобы картинки попали на телефон без сжатия: панель → **English** → «Оформление канала» → кнопки
«Баннер», «Аватар» → «Сохранить изображение» (в «Фото» как есть). Или отправьте их себе в
Telegram «Избранное» **как файл** (не как фото) и сохраните в галерею.

## YouTube с компьютера (studio.youtube.com)

1. **Фото профиля и баннер.** Слева **«Настройка канала»** → вкладка **«Профиль»** (в старом
   интерфейсе — «Брендинг»).
   - «Фото профиля» → **«Изменить»** → `avatar-youtube.png`. Рамку не двигайте: знак уже по центру
     круга. Лимит YouTube — 4 МБ, файл около 0,13 МБ.
   - «Изображение баннера» → **«Изменить»** → `banner-youtube.png` → ничего не трогайте →
     **«Готово»**. Весь текст стоит в зоне 1546×423, которую видно на всех устройствах; иконки рубрик
     по бокам видны только на компьютере и ТВ. Лимит — 6 МБ, файл около 1,2 МБ.
2. **Водяной знак.** Там же, блок **«Водяной знак»** → **«Загрузить»** → `watermark-youtube.png` →
   «Время показа»: **«Всё видео»**. Лимит — 1 МБ, файл 17 КБ.
3. **Описание.** «Настройка канала» → «Профиль» → **«Описание»** → вставьте текст из блока
   «Описание канала» ниже (весь текст внутри рамки, 875 знаков из 1000).
4. Нажмите **«Опубликовать»** справа вверху. Баннер и аватар обновляются за несколько минут,
   иногда до суток.
5. **Ключевые слова.** Слева внизу **«Настройки»** (шестерёнка) → **«Канал»** →
   **«Основная информация»** → «Ключевые слова» → вставьте строку из блока ниже → **«Сохранить»**.
6. Там же, как у русского канала (`docs/youtube-setup.md`, шаг 5), но для английского:
   «Загрузка видео по умолчанию» → «Язык видео» и «Язык названия и описания» — **«английский»**;
   «Категория» — **«Образование»**; «Изменённый или синтетический контент» — **«Да»** (голос ИИ).
   «Канал» → «Расширенные настройки» → «Аудитория»: **«Нет, этот канал не для детей»**.

## Тексты для YouTube

Кнопки «Скопировать описание» и «Скопировать ключевые слова» в панели берут текст прямо из блоков
ниже — правьте его только здесь (заголовки блоков не меняйте; проверка — `panel/scripts/brand-kit-test.ts`).

### Описание канала

```
Gist in a Minute: short educational videos about everything. Science, space, the human body, psychology, history, tech and money. Complex made simple, in 60 seconds.

Two new Shorts every day. One video, one clear idea that is easy to remember and share with friends.

What you'll find here:
• Mind & psychology
• Body & health (no medical advice)
• Space
• Nature & animals
• History
• Tech & AI
• Money & economics
• Why is that? Answers to the questions you've always wanted to ask

Only verifiable facts from reliable sources: scientific papers, encyclopedias, official statistics. No mysticism, no clickbait. Spotted a mistake? Tell us in the comments and we'll correct it.

The narration in our videos is AI-generated.

Videos are for general education and are not a substitute for professional advice (medical, legal or financial).

Subscribe for a new gist every day.
```

Это перевод описания русского канала (`content/channel-texts.md`) с двумя добавками: строка про
голос ИИ и дисклеймер из `channels/en.json`. В описании обещано исправлять ошибки: когда зритель
найдёт ошибку, поправку стоит закрепить в комментариях, как у русского канала.

### Ключевые слова

```
gist in a minute, interesting facts, science facts, did you know, learn something new, educational shorts, space, psychology, history, technology
```

## Instagram (когда заведёте английский аккаунт)

Пока в `channels/en.json` → `links.instagram` стоит `null`. Заведёте аккаунт — впишите туда ссылку.

1. **Фото профиля:** Профиль → **«Редактировать профиль»** → **«Изменить фото»** →
   `avatar-instagram.png`.
2. **Обложки «Актуального»** (по одной на рубрику). Instagram вырезает из центра круг; всё
   важное уже внутри него. Создать: выложите хотя бы одну историю рубрики → Профиль → **«+ Новое»**
   → выберите истории → **«Далее»** → **«Редактировать обложку»** → значок галереи → файл из
   `highlights/` → **«Готово»**. Названия под кружками:

   | Файл | Название |
   |---|---|
   | `mind.png` | Mind |
   | `body.png` | Body |
   | `space.png` | Space |
   | `nature.png` | Nature |
   | `history.png` | History |
   | `tech.png` | Tech |
   | `money.png` | Money |
   | `why.png` | Why? |

3. **Пост-знакомство:** «+» → **«Публикация»** → `instagram-post-intro.png` → формат **4:5**
   (значок кадрирования) → текст ниже → «Поделиться». Потом «⋯» → **«Закрепить в профиле»**.
   Эту же картинку можно выложить на YouTube во вкладку «Записи» первым сообщением канала.

### Подпись к посту-знакомству

```
Hi! This is Gist in a Minute.

Two short videos every day, each with one clear idea about how the world works, in a minute.

Mind & psychology
Body & health
Space
Nature & animals
History
Tech & AI
Money & economics
"Why is that?"

Only verifiable facts. No mysticism, no clickbait.
Follow along and tell us in the comments which topic we should cover first.

#gistinaminute #facts #science #didyouknow #learnsomethingnew #sciencefacts #todayilearned
```

## Как перерисовать

```bash
npm run brand -- --channel=en                       # всё → brand/en/ (≈40 с)
npm run brand -- --channel=en --only=banner,post    # только часть: avatar, banner, watermark, highlights, post, preview
npm run brand -- --channel=en --out=out/brand-en    # в другую папку, brand/en/ не трогать
```

- Название, ник, слоган, рубрики и число роликов в день — в `channels/en.json`.
- Английские надписи, которых нет в файле канала (короткие подписи «Актуального», «2 new videos a
  day», «Hello», абзац поста, слово на маркере «simple»), — в `src/remotion/brand/texts.ts`.
- Русский кит рисуется как раньше: `npm run brand` → `brand/`.
