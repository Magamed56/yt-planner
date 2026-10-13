# L05 — отчёт по сценарию «Разбора»

**Файл:** `scripts/razbor-L05-rozettskiy-kamen-kak-na-samom-dele-rasshifrovali-ieroglify.json`

## Название
- **Выбрано:** «Розеттский камень: как на самом деле расшифровали иероглифы» (59 симв.). Главный запрос «Розеттский камень» стоит в начале, а «как расшифровали иероглифы» — в середине. «На самом деле» оправдано: ролик разбирает миф, будто камень сразу дал перевод, и спор о том, кому принадлежит заслуга.
- Запасной 1: «Как расшифровали иероглифы: Розеттский камень, Юнг и Шампольон» (62).
- Запасной 2: «Розеттский камень и гонка двух гениев: кто прочитал иероглифы» (61).

## Хук и обложка
- **Хук (s1):** «Четырнадцать веков никто на Земле не мог прочитать иероглифы.» (9 слов). Сразу после него идёт открытая петля (s2): «кто победил» и «почему знаменитый камень сам ответа не дал». Первую часть закрывают s35 и cta, вторую — s14 и s37.
- **Обложка:** текст «Два гения. Одна *загадка*» (23 симв., капсом, акцент на «загадка»), иконка `pyramid`, плашка **≈1400 лет** (первая stat-сцена s3).

## Главы, объём
| Глава | Сцены |
|---|---|
| Четырнадцать веков тишины | s1–s5 |
| Находка в стене форта | s6–s13 |
| Юнг и картуши | s14–s19 |
| Подсказка с обелиска | s20–s24 |
| Утро четырнадцатого сентября | s25–s31 |
| Кто же победил | s32–s38 |

- 38 сцен: hook 1, statement 17, media 10, stat 4, list 2, quote 2, quiz 1 (миф о «готовом переводе»), cta 1. Есть одна карта (Рашид) и одна сцена-сравнение (строки трёх блоков).
- 925 слов. Это ≈ 7 мин 40 с при 2,0 слова/с плюс пауза викторины; script-check считает по 2,1 слова/с и даёт ≈ 440 с.
- Проверка `npx tsx src/dev/script-check.mts …` в PowerShell: ✔ схема и структура, без ✖. Остались только замечания «проверь факт s3/s8/s18/s22» — источники к ним ниже. Под Git Bash тот же скрипт падает с `ERR_UNSUPPORTED_ESM_URL_SCHEME`: он импортирует путь `C:\…` без `file://`. В PowerShell всё работает.
- Тема `sunset`. У всех imagePrompt общая палитра «warm sand gold and deep lapis blue palette».

## Источники: утверждение → URL
Страницы britishmuseum.org/blog, britannica.com и smithsonianmag.com отвечали 403. Факты оттуда сверены по выдаче поиска и по Википедии. Лимит WebSearch (200 на ход, общий для всех агентов) закончился посреди работы. Оставшиеся проверки сделаны через WebFetch прямо по страницам Википедии, Yale и Вестминстерского аббатства.

| Сцена | Утверждение | Источник |
|---|---|---|
| s1, s3 | Последняя известная надпись иероглифами вырезана жрецом на Филе в 394 г.; знание иероглифов затем утрачено | https://en.wikipedia.org/wiki/Graffito_of_Esmet-Akhom ; https://en.wikipedia.org/wiki/Egyptian_hieroglyphs |
| s3 | Снова прочитаны в 1822 г. (Lettre à M. Dacier); ≈1400 лет = 1822 − 394 = 1428 | https://en.wikipedia.org/wiki/Lettre_%C3%A0_M._Dacier |
| s2, s15 | Юнг — английский врач и физик, доказал интерференцию света, то есть волновую природу света | https://www.britannica.com/biography/Thomas-Young ; https://en.wikipedia.org/wiki/Thomas_Young_(scientist) |
| s4 | Гораполлон (IV–V вв.) толковал знаки аллегорически: гусь = «сын», потому что гуси любят птенцов; на деле «гусь» и «сын» по-египетски записывались одними согласными | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts ; https://en.wikipedia.org/wiki/Egyptian_hieroglyphs |
| s5 | Кирхер (XVII в.) превращал короткие надписи в мистические тексты: где написано «Слова Осириса Джедхера» (формула с именем умершего), он вычитал рассуждение о природе | https://echoesofegypt.peabody.yale.edu/node/238 ; https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts |
| s6, s7 | Июль 1799 г.; солдаты разбирали стену форта (Форт Жюльен) у Рашида; плиту заметил офицер Пьер-Франсуа Бушар | https://en.wikipedia.org/wiki/Rosetta_Stone ; https://en.wikipedia.org/wiki/Pierre-Fran%C3%A7ois_Bouchard |
| s6 | Французы звали Рашид Розеттой; координаты 31.40° с. ш., 30.42° в. д. | https://en.wikipedia.org/wiki/Rosetta |
| s8 | Серо-розовый гранодиорит, высота 112,3 см | https://www.britishmuseum.org/collection/object/Y_EA24 |
| s8 | Вес ≈ 760 кг; камень — обломок более высокой стелы | https://en.wikipedia.org/wiki/Rosetta_Stone |
| s9 | Три блока: иероглифы, демотика, греческий; греческий — язык власти Птолемеев | https://www.britishmuseum.org/collection/object/Y_EA24 ; https://en.wikipedia.org/wiki/Ptolemaic_Kingdom |
| s10 | Указ жрецов, собравшихся в Мемфисе, 196 г. до н. э.; юный Птолемей V (коронован в 12 лет) | https://en.wikipedia.org/wiki/Rosetta_Stone_decree |
| s11 | Конец указа: выбить на стеле из твёрдого камня «священными, местными и греческими» знаками и поставить в храмах первого, второго и третьего ранга | https://www.attalus.org/egypt/rosettastone.html |
| s12 | 15 сентября 1799 г. Courier de l'Égypte (Каир): греческий текст может дать ключ к иероглифам | https://www.nationalgeographic.com/history/history-magazine/article/hieroglyphics-were-a-mystery-until-he-solved-the-rosetta-stone |
| s12 | Камень покрывали типографской краской, прокатывали бумагу валиком; оттиски рассылали учёным Европы | https://gutenberg.org/files/48649/48649-h/48649-h.htm (Budge) ; https://www.lindahall.org/experience/digital-exhibitions/napoleon-and-the-scientific-expedition-to-egypt/15-the-rosetta-stone/ |
| s14 | Строк: иероглифы 14, демотика 32, греческий 54; все строки иероглифов обломаны справа | https://www.britishmuseum.org/collection/object/Y_EA24 ; https://en.wikipedia.org/wiki/Rosetta_Stone |
| s16 | Лето 1814 г.: Юнг берёт копию надписи на отдых в Уэртинг; метод — подсчёт повторов | https://www.nature.com/articles/483027a.pdf ; https://homes.luddy.indiana.edu/rawlins/books/moths/secrets.html ; https://history.rcp.ac.uk/blog/thomas-young-and-decipherment-hieroglyphics |
| s17 | Юнг определил, что картуши содержат имя Птолемея | https://history.rcp.ac.uk/blog/thomas-young-and-decipherment-hieroglyphics |
| s18 | Статья «Egypt» в Британской энциклопедии, 1819 (анонимно); из 13 звуковых значений 6 верны, 3 частично | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts ; https://www.natureasia.com/en/nmiddleeast/article/10.1038/nmiddleeast.2012.24 |
| s19 | Юнг считал, что звуковые знаки бывают только в иноземных именах вроде Птолемея | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts |
| s20 | В 16 лет (1806) Шампольон выступил с докладом: египетский язык дожил в коптском; с 1808 г. работал с копией камня | https://www.nationalgeographic.com/history/history-magazine/article/hieroglyphics-were-a-mystery-until-he-solved-the-rosetta-stone ; https://en.wikipedia.org/wiki/Jean-Fran%C3%A7ois_Champollion |
| s21 | Коптский — поздний египетский, пишется греческим алфавитом с 7 демотическими буквами; Шампольон, по свидетельствам, свободно на нём говорил | https://en.wikipedia.org/wiki/Coptic_language ; https://en.wikipedia.org/wiki/Jean-Fran%C3%A7ois_Champollion |
| s22 | 1419 иероглифов на 486 греческих слов, значит, письмо не чисто идеографическое | https://wol.jw.org/en/wol/d/r1/lp-e/101971847 ; https://www.thecollector.com/rosetta-stone-secrets-unlocked/ (см. «спорное») |
| s23 | Обелиск с Филе привезён в Лондон в декабре 1821 г.; греческая надпись на постаменте, иероглифы на стволе; Бэнкс пометил на полях копии картуш «Клеопатра» | https://en.wikipedia.org/wiki/Philae_obelisk ; https://www.lindahall.org/about/news/scientist-of-the-day/william-john-bankes/ |
| s24 | Сравнение картушей: p, o, l совпали; t — разные знаки (омофоны); лев = L | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts ; https://sacred-texts.com/egy/trs/trs05.htm |
| s25, s26 | 14 сентября 1822 г., утро; копии надписей из храма Абу-Симбел прислал архитектор Юйо | https://en.wikipedia.org/wiki/Jean-Nicolas_Huyot ; https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts |
| s26 | Абу-Симбел высечен в XIII в. до н. э. (≈1264 г.), Птолемеи — с 305 г. до н. э., то есть почти за тысячу лет до них | https://en.wikipedia.org/wiki/Abu_Simbel ; https://en.wikipedia.org/wiki/Ptolemaic_Kingdom |
| s27 | Рамсес: солнце = «ре» (копт.), знак «м» по коптскому «мисе» (рождение), дважды «с» | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts |
| s28 | Тутмос: ибис — символ Тота | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts |
| s29 | Ворвался к брату Жаку-Жозефу в библиотеку Института Франции, «Je tiens l'affaire!», упал без чувств; рассказ по биографии Хартлебен (1906), документирован не полностью | https://en.wikipedia.org/wiki/Lettre_%C3%A0_M._Dacier ; https://www.herodote.net/Jean_Francois_Champollion_1790_1832_-synthese-3337.php ; https://www.universalis.fr/encyclopedie/jean-francois-champollion/ |
| s30 | 27 сентября 1822 г., Академия надписей, «Письмо господину Дасье» (секретарю академии); Юнг в зале — их первая встреча | https://en.wikipedia.org/wiki/Lettre_%C3%A0_M._Dacier ; https://history.rcp.ac.uk/blog/thomas-young-and-decipherment-hieroglyphics ; https://en.wikipedia.org/wiki/Jean-Fran%C3%A7ois_Champollion |
| s31 | Цитата из «Précis» 1824 г. (с. 327): «une écriture tout à la fois figurative, symbolique et phonétique, dans un même texte, une même phrase, je dirais presque dans un même mot» | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts ; https://www.bibliorare.com/lot/497779/ |
| s32 | Юнг сначала хвалил работу Шампольона, в 1823 г. выпустил книгу с подзаголовком «…the author's original alphabet, as extended by Mr Champollion»; Шампольон долга не признал | https://history.rcp.ac.uk/blog/thomas-young-and-decipherment-hieroglyphics ; https://en.wikipedia.org/wiki/Thomas_Young_(scientist) |
| s33 | Экспедиция в Египет с 1828 г. (16 месяцев), чтение надписей на месте; умер в 1832 г. в 41 год | https://echoesofegypt.peabody.yale.edu/node/243 ; https://www.nationalgeographic.com/history/history-magazine/article/hieroglyphics-were-a-mystery-until-he-solved-the-rosetta-stone ; https://en.wikipedia.org/wiki/Jean-Fran%C3%A7ois_Champollion |
| s34 | Юнг умер 10 мая 1829 г.; доска в Вестминстерском аббатстве: «first penetrated the obscurity which had veiled for ages the hieroglyphicks of Egypt» | https://www.westminster-abbey.org/abbey-commemorations/commemorations/thomas-young |
| s35 | Р. Паркинсон: «Young discovered parts of an alphabet — a key — but Champollion unlocked an entire language» (Parkinson 1999, с. 40) | https://en.wikipedia.org/wiki/Decipherment_of_ancient_Egyptian_scripts |
| s36 | 1801: камень по договору (Александрия) перешёл к британцам; в Британском музее с 1802 г.; по данным музея — самый посещаемый экспонат | https://en.wikipedia.org/wiki/Rosetta_Stone ; https://www.britishmuseum.org/collection/object/Y_EA24 |

## Неточности в плане (content/long-plan.json) и что исправлено
1. **Хук «почти полторы тысячи лет»** — преувеличение. От последней известной надписи (394 г.) до 1822 г. прошло 1428 лет, а когда исчезли последние читатели, точно не известно. В сценарии стоит «Четырнадцать веков», на плашке — «≈1400 лет».
2. **«29 камней с такими декретами, 22 в Египте»** — в таком виде неточно. Блог Британского музея считает камни с жреческими указами вообще, а не копии именно этого указа. В 2022 г. музей называл 28 и 21. В другом месте музей говорит о четырёх известных копиях указа Птолемея V. Википедия даёт около десяти точно датированных копий родственных указов. **В сценарий цифра не вошла.**
3. **Решающий шаг Шампольона.** План связывает «Я понял!» с выводом из картушей Птолемея и Клеопатры. На самом деле прорыв 14 сентября 1822 г. — чтение коренных египетских имён (Рамсес, Тутмос) по копиям Юйо из Абу-Симбела. Это опровергло идею Юнга, что звуками пишут только иноземные имена. В сценарии порядок исправлен.
4. **Клеопатра на обелиске с Филе** — это не знаменитая Клеопатра VII, а Клеопатры II/III. В сценарии имя просто названо, без отождествления. Пометку Бэнкса на полях добавил ради честности. Видел ли её Шампольон, неизвестно.
5. **«Юнг прочитал имена нескольких цариц»** — верно (Йельский музей Пибоди), но имя Береники он взял не с Розеттского камня. В сценарии это не упоминается, только итог: из 13 звуковых значений 6 верны, 3 частично.
6. **«После поражения французов… по капитуляции»** — по правилам канала подано нейтрально: «по договору перешёл к британцам». Детали военной кампании и «Египетский поход Наполеона» убраны.
7. **«Я понял!» и обморок** — подано как предание («по преданию», «документов мало»). Википедия ссылается на биографию Хартлебен 1906 г. и отмечает, что эпизод документирован не полностью. Версию о пяти днях без сознания (Universalis, Hérodote) в сценарий не брал.

## Что осталось спорным
- **1419 знаков / 486 слов (s22).** Эти числа подтверждают только вторичные источники (Watchtower, TheCollector). Один французский документ (ARCSI) даёт 1519. Статья Википедии о Шампольоне формулирует довод иначе, через число *различных* знаков. Довод сам по себе классический («Précis», 1824). Если нужна стопроцентная точность, можно заменить число на «почти втрое больше» или сверить с «Précis» на Gallica.
- **Дата находки:** 15 или 19 июля 1799 г. В сценарии сказано просто «лето» и «июль».
- **Год статьи Юнга:** 1819 (вышел том) или 1818 (так в английской Википедии). Взят 1819, как у RCP, Йеля и Nature Middle East.
- **Кому принадлежит заслуга:** историки расходятся. В сценарии это подано как спор: эпитафия Юнгу, цитата Паркинсона и вопрос зрителю.
- **«Самый посещаемый экспонат»** — это данные самого музея, Захи Хавасс их оспаривает. Поэтому в тексте «по данным музея».
- **Датировка Гораполлона:** IV или V в. В тексте сказано «ещё в древности».
