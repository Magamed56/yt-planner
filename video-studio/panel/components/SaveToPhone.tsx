"use client";
import { useEffect, useState } from "react";
import { assetType, parseContentRange } from "@/lib/asset-range";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} МБ`;

// Файл релиза в память кусками через /api/asset/<id>/file (каждый ответ — не больше 4 МБ),
// с прогрессом. Оборвался кусок — следующий запрос продолжит с того же байта.
async function fetchAsset(id: number, onProgress: (done: number, total: number) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  let done = 0;
  let total = 0;
  let type = "";
  for (;;) {
    const res = await fetch(`/api/asset/${id}/file`, { headers: { Range: `bytes=${done}-` }, cache: "no-store" });
    if (res.status !== 200 && res.status !== 206) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
    const whole = res.status === 200; // панель отдала файл целиком (без диапазона)
    const range = whole ? null : parseContentRange(res.headers.get("content-range"));
    if (!whole && range?.start !== done) throw new Error("Панель вернула не тот кусок файла — попробуйте ещё раз.");
    if (whole) {
      parts.length = 0;
      done = 0;
    }
    total = range ? range.total : Number(res.headers.get("content-length")) || 0;
    type = res.headers.get("content-type") ?? type;
    const before = done;
    const reader = res.body!.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parts.push(chunk.value);
      done += chunk.value.length;
      onProgress(done, total);
    }
    if (whole || done >= total) break;
    if (done === before) throw new Error("Файл не докачался — попробуйте ещё раз.");
  }
  return new Blob(parts, { type });
}

// «Сохранить в Фото» на телефоне — в два нажатия: iPhone не откроет меню «Поделиться» после
// долгого ожидания (жест пользователя «остывает»). Первое — скачать файл в память, второе —
// navigator.share с файлом: в меню «Сохранить видео». Файл тот же, что в релизе, байт в байт.
// Где делиться файлами нельзя (компьютер), кнопки нет — там обычные ссылки «⬇».
export default function SaveToPhone({ id, name, size, what }: { id: number; name: string; size: number; what: "видео" | "обложку Reels" | "обложку YouTube" }) {
  const type = assetType(name, null);
  const isVideo = type.startsWith("video/");
  const [canShare, setCanShare] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready">("idle");
  const [progress, setProgress] = useState({ done: 0, total: size });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Проверка — только в браузере: на сервере navigator нет, и разметка не должна расходиться.
  useEffect(() => {
    try {
      const probe = new File([new Uint8Array(1)], name, { type });
      setCanShare(Boolean(navigator.canShare?.({ files: [probe] })) && window.matchMedia("(pointer: coarse)").matches);
    } catch {
      setCanShare(false);
    }
  }, [name, type]);

  if (!canShare) return null;

  async function prepare() {
    setPhase("loading");
    setError(null);
    try {
      const blob = await fetchAsset(id, (done, total) => setProgress({ done, total }));
      setFile(new File([blob], name, { type }));
      setPhase("ready");
    } catch (e) {
      setPhase("idle");
      setError(`Не скачалось: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function share() {
    if (!file) return;
    try {
      // Только файл, без текста: с текстом iPhone прячет пункт «Сохранить видео».
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // закрыли меню
      setError(`Меню «Поделиться» не открылось (${e instanceof Error ? e.message : String(e)}) — скачайте файлом.`);
    }
  }

  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div className="save-phone">
      {phase === "ready" ? (
        <button className="btn small primary" onClick={share}>
          📱 Сохранить в Фото
        </button>
      ) : (
        <button className="btn small" disabled={phase === "loading"} onClick={prepare}>
          {phase === "loading" ? `Готовлю… ${pct}%` : `📱 Подготовить ${what} (${mb(size)})`}
        </button>
      )}
      {phase === "loading" && <progress max={100} value={pct} aria-label={`Скачано ${pct}%`} />}
      {phase === "ready" && (
        <span className="small muted">
          В меню выберите «{isVideo ? "Сохранить видео" : "Сохранить изображение"}» — файл без пережатия, в исходном качестве.
        </span>
      )}
      {error && (
        <span className="small flag">
          {error}{" "}
          <a href={`/api/asset/${id}/file?download=1`} download={name}>
            Скачать файлом
          </a>
        </span>
      )}
    </div>
  );
}
