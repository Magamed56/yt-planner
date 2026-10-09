"use client";
// Скачать файлы одного или нескольких роликов: видео, вертикальную обложку, обложку YouTube.
// Телефон — «Сохранить в Фото» через меню «Поделиться» (частями, если файлов много); компьютер —
// файлами по очереди, с кодом ролика в имени. Что отмечено — запоминается на этом устройстве.
import { useEffect, useRef, useState } from "react";
import { assetType, parseContentRange } from "@/lib/asset-range";
import { FILE_KINDS, fileHref, filesOf, KIND_LABEL, kindTotals, shareGroups, type FileKind, type SaveFile, type SaveItem } from "@/lib/downloads";
import { plural } from "@/lib/stages";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} МБ`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KINDS_KEY = "panel.files.kinds";

// Одно меню «Поделиться»: Chrome (Android) принимает не больше 10 файлов и 50 МБ за раз, Safari
// жёстких лимитов не ставит, но держит всё в памяти телефона — там части по 200 МБ.
const SHARE_MAX_FILES = 10;
const SHARE_MAX_BYTES = { ios: 200 * 1_048_576, android: 48 * 1_048_576 };

// iPhone/iPad — «Сохранить в Фото» через меню «Поделиться» (иначе видео попадёт только в
// «Файлы»). Android — скачивание: файлы из «Загрузок» сразу видны в галерее, а меню
// «Поделиться» у Chrome не берёт больше 50 МБ. Компьютер — скачивание.
type Platform = "ios" | "android" | "desktop";

function platformOf(): Platform {
  try {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    const share = Boolean(navigator.canShare?.({ files: [probe] }));
    if (!touch) return "desktop";
    // У Chromium есть userAgentData, у Safari (и у Chrome на iPhone — он тоже WebKit) — нет.
    if ("userAgentData" in navigator) return "android";
    return share ? "ios" : "android";
  } catch {
    return "desktop";
  }
}

const filesLabel = (n: number) => `${n} ${plural(n, "файл", "файла", "файлов")}`;

// Файл релиза в память кусками через /api/asset/<id>/file (каждый ответ — не больше 4 МБ),
// с прогрессом. Оборвался кусок — тот же запрос ещё раз (до 3 попыток) с того же байта.
async function fetchAsset(id: number, signal: AbortSignal, onProgress: (done: number) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  let done = 0;
  let total = 0;
  let type = "";
  let fails = 0;
  for (;;) {
    const before = done;
    try {
      const res = await fetch(`/api/asset/${id}/file`, { headers: { Range: `bytes=${done}-` }, cache: "no-store", signal });
      if (res.status !== 200 && res.status !== 206) {
        const text = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
        throw Object.assign(new Error(text), { retry: res.status >= 500 });
      }
      const whole = res.status === 200; // панель отдала файл целиком (без диапазона)
      const range = whole ? null : parseContentRange(res.headers.get("content-range"));
      if (!whole && range?.start !== done) throw new Error("Панель вернула не тот кусок файла — попробуйте ещё раз.");
      if (whole) {
        parts.length = 0;
        done = 0;
      }
      total = range ? range.total : Number(res.headers.get("content-length")) || 0;
      type = res.headers.get("content-type") ?? type;
      const reader = res.body!.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parts.push(chunk.value);
        done += chunk.value.length;
        onProgress(done);
      }
      if (whole || done >= total) break;
      if (done === before) throw new Error("Файл не докачался — попробуйте ещё раз.");
      fails = 0;
    } catch (e) {
      if (signal.aborted) throw e;
      // Сеть моргнула или GitHub не ответил вовремя (502) — продолжаем с того же байта.
      const retry = !(e instanceof Error) || !("retry" in e) || (e as { retry?: boolean }).retry === true;
      if (!retry || ++fails > 2) throw e;
      await sleep(fails * 1500);
    }
  }
  return new Blob(parts, { type });
}

type Share = { phase: "idle" } | { phase: "loading"; part: number; done: number; total: number } | { phase: "ready"; part: number; files: File[] } | { phase: "done"; parts: number };

function savedKinds(): FileKind[] | null {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(KINDS_KEY) ?? "null");
    return Array.isArray(j) ? FILE_KINDS.filter((k) => j.includes(k)) : null;
  } catch {
    return null;
  }
}

export default function FilesSaver({ items }: { items: SaveItem[] }) {
  const [kinds, setKinds] = useState<FileKind[]>(FILE_KINDS);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [share, setShare] = useState<Share>({ phase: "idle" });
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const groups = useRef<SaveFile[][]>([]);
  const abort = useRef<AbortController | null>(null);

  // Только в браузере: на сервере нет navigator и localStorage, разметка не должна расходиться.
  useEffect(() => {
    const saved = savedKinds();
    if (saved) setKinds(saved);
    setPlatform(platformOf());
    return () => abort.current?.abort();
  }, []);

  const files = filesOf(items, kinds);
  const bytes = files.reduce((s, f) => s + f.size, 0);
  const totals = kindTotals(items);
  const many = items.length > 1;
  const busy = share.phase === "loading" || saving !== null;
  const locked = busy || share.phase === "ready";

  function toggle(kind: FileKind) {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : FILE_KINDS.filter((k) => k === kind || kinds.includes(k));
    setKinds(next);
    setNote(null);
    setShare({ phase: "idle" });
    try {
      localStorage.setItem(KINDS_KEY, JSON.stringify(next));
    } catch {
      // приватный режим — просто не запомним
    }
  }

  async function prepare(part: number) {
    const group = groups.current[part];
    if (!group) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const total = group.reduce((s, f) => s + f.size, 0);
    setNote(null);
    setShare({ phase: "loading", part, done: 0, total });
    try {
      const out: File[] = [];
      let base = 0;
      let shown = 0;
      for (const f of group) {
        const blob = await fetchAsset(f.assetId, ctrl.signal, (d) => {
          // Перерисовка — только когда сменился процент, а не на каждый кусок сети.
          const p = total ? Math.floor(((base + d) / total) * 100) : 0;
          if (p !== shown) setShare({ phase: "loading", part, done: base + d, total });
          shown = p;
        });
        out.push(new File([blob], f.name, { type: assetType(f.name, null) }));
        base += blob.size;
      }
      if (!navigator.canShare?.({ files: out })) throw new Error("телефон не даёт поделиться этими файлами");
      // Успели быстро (обложки, маленькое видео) — нажатие ещё «живое»: меню открывается сразу.
      if ((navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive) await shareFiles(part, out);
      else setShare({ phase: "ready", part, files: out });
    } catch (e) {
      setShare({ phase: "idle" });
      if (!ctrl.signal.aborted) setNote({ ok: false, text: `Не скачалось: ${e instanceof Error ? e.message : String(e)}. Попробуйте ещё раз.` });
    }
  }

  function startShare() {
    if (!files.length) return;
    groups.current = shareGroups(files, SHARE_MAX_FILES, SHARE_MAX_BYTES[platform === "ios" ? "ios" : "android"]);
    void prepare(0);
  }

  // Второе нажатие: iPhone открывает «Поделиться» только сразу после касания, поэтому файлы
  // готовятся заранее. Только файлы, без текста: с текстом iPhone прячет «Сохранить видео».
  async function shareFiles(part: number, ready: File[]) {
    try {
      await navigator.share({ files: ready });
    } catch (e) {
      setShare({ phase: "ready", part, files: ready }); // закрыли меню или не открылось — часть остаётся готовой
      if (e instanceof DOMException && e.name === "AbortError") return;
      setNote({ ok: false, text: `Меню «Поделиться» не открылось (${e instanceof Error ? e.message : String(e)}) — нажмите ещё раз.` });
      return;
    }
    if (part + 1 < groups.current.length) void prepare(part + 1);
    else setShare({ phase: "done", parts: groups.current.length });
  }

  function shareReady() {
    if (share.phase === "ready") void shareFiles(share.part, share.files);
  }

  // Компьютер (и «Скачать файлами» на телефоне): ссылки по очереди. Пауза — чтобы браузер
  // успел принять каждую загрузку; про пачку файлов он спросит один раз.
  async function downloadAll() {
    if (!files.length || busy) return;
    setNote(null);
    setShare({ phase: "idle" });
    const list = [...files];
    for (let i = 0; i < list.length; i++) {
      setSaving({ done: i, total: list.length });
      const a = document.createElement("a");
      a.href = fileHref(list[i]!);
      a.download = list[i]!.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (i < list.length - 1) await sleep(900);
    }
    setSaving(null);
    setNote({
      ok: true,
      text:
        list.length > 1
          ? `Отправлено в загрузки: ${filesLabel(list.length)}. Если браузер спросил про несколько файлов — разрешите; недостающее скачайте по одному ниже.`
          : "Файл скачивается — он в «Загрузках».",
    });
  }

  const pct = share.phase === "loading" && share.total ? Math.min(100, Math.round((share.done / share.total) * 100)) : 0;
  const shareLabel = platform === "ios" ? "📱 Сохранить в Фото" : "📤 Поделиться";
  const downloadButton = (
    <button className="btn primary" disabled={!files.length || busy} onClick={downloadAll}>
      {saving ? `Скачиваю ${saving.done + 1} из ${saving.total}…` : `⬇ Скачать ${filesLabel(files.length)} · ${mb(bytes)}`}
    </button>
  );
  const parts = groups.current.length;
  const partLabel = (part: number) => (parts > 1 ? ` — часть ${part + 1} из ${parts}` : "");

  return (
    <div className="files-saver">
      <div className="kinds" role="group" aria-label="Что скачать">
        {FILE_KINDS.map((k) => {
          const t = totals[k];
          if (!t.count) return null;
          const count = many ? ` · ${t.count === items.length ? `${t.count} шт.` : `у ${t.count} из ${items.length}`}` : "";
          return (
            <label key={k} className="kind">
              <input type="checkbox" checked={kinds.includes(k)} disabled={locked} onChange={() => toggle(k)} />
              <span>
                {KIND_LABEL[k]}
                <span className="muted small">
                  {count} · {mb(t.size)}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="btn-row">
        {platform === "desktop" ? (
          downloadButton
        ) : share.phase === "ready" ? (
          <button className="btn primary" onClick={shareReady}>
            {shareLabel}
            {partLabel(share.part)}
          </button>
        ) : share.phase === "loading" ? (
          <button className="btn" disabled>
            Готовлю{partLabel(share.part)}… {pct}%
          </button>
        ) : platform === "ios" ? (
          <button className="btn primary" disabled={!files.length || busy} onClick={startShare}>
            {shareLabel} · {filesLabel(files.length)}, {mb(bytes)}
          </button>
        ) : (
          downloadButton
        )}
        {platform !== "desktop" &&
          (share.phase === "loading" || share.phase === "ready" ? (
            <button
              className="btn small ghost"
              onClick={() => {
                abort.current?.abort();
                setShare({ phase: "idle" });
              }}
            >
              Отмена
            </button>
          ) : platform === "android" ? (
            <button className="btn small ghost" disabled={!files.length || busy} onClick={startShare}>
              {shareLabel}
            </button>
          ) : null)}
      </div>
      {platform === "ios" && share.phase === "idle" && files.length > 0 && (
        <p className="small muted">Откроется меню телефона: «Сохранить видео» — в «Фото», «Сохранить в Файлы» — в «Файлы». Ничего не пережимается.</p>
      )}

      {share.phase === "loading" && <progress max={100} value={pct} aria-label={`Скачано ${pct}%`} />}
      {share.phase === "ready" && (
        <p className="small muted">
          Готово {filesLabel(share.files.length)}.{" "}
          {platform === "ios" ? "В меню выберите «Сохранить» — видео и обложки лягут в «Фото» в исходном качестве" : "В меню выберите приложение — TikTok, Instagram, Google Фото"}
          {parts > 1 ? "; следующая часть начнёт готовиться сама" : ""}.
        </p>
      )}
      {share.phase === "done" && (
        <p className="small ok-text">
          ✓ {platform === "ios" ? "Всё отдано в «Фото»" : "Готово"}
          {share.parts > 1 ? ` (частей: ${share.parts})` : ""}.{" "}
          <button className="link-btn" onClick={() => setShare({ phase: "idle" })}>
            Ещё раз
          </button>
        </p>
      )}
      {!files.length && <p className="small muted">Отметьте, что скачать.</p>}
      <div role="status" aria-live="polite">
        {note && <p className={`small ${note.ok ? "muted" : "flag"}`}>{note.text}</p>}
      </div>

      {/* На iPhone ссылка на файл уводит из панели на страницу просмотра — там только меню выше. */}
      {files.length > 1 && platform !== "ios" && (
        <details className="one-by-one">
          <summary>По одному файлу ({files.length})</summary>
          <ul>
            {files.map((f) => (
              <li key={f.key}>
                <a href={fileHref(f)} download={f.name}>
                  ⬇ {f.name}
                </a>
                <span className="muted small">{mb(f.size)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
