"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoStage } from "@prisma/client";
import StageSelect from "@/components/StageSelect";
import Modal from "@/components/Modal";
import type { VideoRow } from "@/components/VideoList";
import { STAGE_LABELS } from "@/lib/stages";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function VideoCard({
  video,
  availableStages,
  onUpdated,
  onDeleted,
}: {
  video: VideoRow;
  availableStages: VideoStage[];
  onUpdated?: (video: VideoRow) => void;
  onDeleted?: (video: VideoRow) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="group rounded-lg border border-line bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-accent hover:shadow-lg hover:shadow-accent/10">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-ink">{video.title}</h3>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                video.isShort
                  ? "bg-accent-soft text-accent ring-accent/20"
                  : "bg-slate-400/15 text-slate-300 ring-slate-400/20"
              }`}
            >
              {video.isShort ? "Shorts" : "Видео"}
            </span>
            <button type="button" onClick={() => setEditOpen(true)} className="shrink-0 text-ink-faint hover:text-accent transition-colors" aria-label="Редактировать" title="Редактировать">
              ✎
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)} className="shrink-0 text-ink-faint hover:text-accent transition-colors" aria-label="История этапов" title="История этапов">
              🕘
            </button>
          </div>
          {video.idea && <p className="mt-1 text-xs text-ink-faint truncate max-w-[60ch]">{video.idea}</p>}
        </div>

        <div className="text-xs text-ink-faint shrink-0">
          {video.plannedPublishAt ? <>План: {dateFmt.format(video.plannedPublishAt)}</> : "Без даты"}
        </div>

        <div className="shrink-0">
          <StageSelect videoId={video.id} currentStage={video.stage} stages={availableStages} onChanged={onUpdated} />
        </div>
      </div>

      {editOpen && <EditVideoModal video={video} onClose={() => setEditOpen(false)} onUpdated={onUpdated} onDeleted={onDeleted} />}
      {historyOpen && (
        <Modal title={`История · ${video.title}`} onClose={() => setHistoryOpen(false)}>
          <div className="space-y-2">
            {video.stageEvents.length === 0 && <p className="text-ink-faint text-sm">Нет записей.</p>}
            {[...video.stageEvents]
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .map((ev) => (
                <div key={ev.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">{STAGE_LABELS[ev.stage]}</span>
                  <span className="text-ink-faint text-xs">{dateTimeFmt.format(ev.createdAt)}</span>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditVideoModal({
  video,
  onClose,
  onUpdated,
  onDeleted,
}: {
  video: VideoRow;
  onClose: () => void;
  onUpdated?: (video: VideoRow) => void;
  onDeleted?: (video: VideoRow) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: video.title,
    idea: video.idea ?? "",
    script: video.script ?? "",
    plannedPublishAt: video.plannedPublishAt ? video.plannedPublishAt.toISOString().slice(0, 10) : "",
    videoUrl: video.videoUrl ?? "",
    notes: video.notes ?? "",
    videoFilePath: video.videoFilePath ?? "",
  });
  const [isShort, setIsShort] = useState(video.isShort);
  const [privacyStatus, setPrivacyStatus] = useState(video.privacyStatus);
  const [initialForm] = useState(form);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm) || isShort !== video.isShort;

  function requestClose() {
    if (isDirty && !confirm("Закрыть без сохранения? Введённые изменения будут потеряны.")) return;
    onClose();
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none transition-all duration-200 focus:border-accent focus:bg-surface-3 focus:ring-1 focus:ring-accent-soft";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        idea: form.idea.trim() || null,
        script: form.script.trim() || null,
        isShort,
        plannedPublishAt: form.plannedPublishAt || null,
        videoUrl: form.videoUrl.trim() || null,
        notes: form.notes.trim() || null,
        videoFilePath: form.videoFilePath.trim() || null,
        privacyStatus,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Ошибка");
      return;
    }
    const updated = await res.json();
    onClose();
    onUpdated?.({
      ...updated,
      plannedPublishAt: updated.plannedPublishAt ? new Date(updated.plannedPublishAt) : null,
      publishedAt: updated.publishedAt ? new Date(updated.publishedAt) : null,
      createdAt: new Date(updated.createdAt),
      updatedAt: new Date(updated.updatedAt),
      stageEvents: updated.stageEvents.map((ev: { createdAt: string }) => ({ ...ev, createdAt: new Date(ev.createdAt) })),
    });
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Удалить «${video.title}»?`)) return;
    setBusy(true);
    const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      alert("Не удалось удалить");
      return;
    }
    onClose();
    onDeleted?.(video);
    router.refresh();
  }

  async function uploadToYoutube() {
    if (!form.videoFilePath.trim()) {
      setUploadError("Укажи путь к файлу видео на диске");
      return;
    }
    setUploading(true);
    setUploadError(null);
    const res = await fetch(`/api/videos/${video.id}/upload-youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoFilePath: form.videoFilePath.trim(), privacyStatus }),
    });
    setUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setUploadError(data.error ?? "Не удалось загрузить");
      return;
    }
    const updated = await res.json();
    onClose();
    onUpdated?.({
      ...updated,
      plannedPublishAt: updated.plannedPublishAt ? new Date(updated.plannedPublishAt) : null,
      publishedAt: updated.publishedAt ? new Date(updated.publishedAt) : null,
      createdAt: new Date(updated.createdAt),
      updatedAt: new Date(updated.updatedAt),
      stageEvents: updated.stageEvents.map((ev: { createdAt: string }) => ({ ...ev, createdAt: new Date(ev.createdAt) })),
    });
    router.refresh();
  }

  return (
    <Modal title="Редактировать видео" onClose={requestClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="metric-label">Название *</label>
          <input value={form.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-dim cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={isShort}
            onChange={(e) => setIsShort(e.target.checked)}
            className="rounded border-line accent-[var(--color-accent)]"
          />
          Shorts
        </label>
        <div>
          <label className="metric-label">Идея / питч</label>
          <textarea value={form.idea} onChange={(e) => set("idea", e.target.value)} className={inputClass} rows={2} />
        </div>
        <div>
          <label className="metric-label">Сценарий</label>
          <textarea value={form.script} onChange={(e) => set("script", e.target.value)} className={inputClass} rows={8} placeholder="Текст сценария…" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="metric-label">Плановая дата публикации</label>
            <input type="date" value={form.plannedPublishAt} onChange={(e) => set("plannedPublishAt", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="metric-label">Ссылка на видео</label>
            <input value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} className={inputClass} placeholder="https://youtube.com/watch?v=…" />
          </div>
        </div>
        <div>
          <label className="metric-label">Заметки</label>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={inputClass} rows={2} />
        </div>

        <div className="space-y-3 pt-3 border-t border-line">
          <p className="label-eyebrow">Автозагрузка на YouTube</p>
          {video.youtubeVideoId && (
            <p className="text-xs text-ink-faint">
              Уже загружено:{" "}
              <a href={video.videoUrl ?? undefined} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {video.videoUrl}
              </a>
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
            <div>
              <label className="metric-label">Путь к файлу видео на диске</label>
              <input
                value={form.videoFilePath}
                onChange={(e) => set("videoFilePath", e.target.value)}
                className={inputClass}
                placeholder="C:\Videos\ролик.mp4"
              />
            </div>
            <div>
              <label className="metric-label">Доступ</label>
              <select
                value={privacyStatus}
                onChange={(e) => setPrivacyStatus(e.target.value)}
                className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none transition-all duration-200 focus:border-accent focus:bg-surface-3 focus:ring-1 focus:ring-accent-soft cursor-pointer"
              >
                <option value="private">Приватное</option>
                <option value="unlisted">По ссылке</option>
                <option value="public">Публичное</option>
              </select>
            </div>
          </div>
          {uploadError && <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">{uploadError}</div>}
          <button type="button" onClick={uploadToYoutube} disabled={uploading} className="btn-secondary text-sm">
            {uploading ? "Загружаю…" : video.youtubeVideoId ? "Загрузить заново" : "Загрузить на YouTube"}
          </button>
        </div>

        {error && <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !form.title.trim()} className="btn-primary text-sm">
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" onClick={requestClose} className="btn-ghost text-sm">
              Отмена
            </button>
          </div>
          <button type="button" onClick={remove} disabled={busy} className="text-sm text-red-400 hover:text-red-300">
            Удалить
          </button>
        </div>
      </form>
    </Modal>
  );
}
