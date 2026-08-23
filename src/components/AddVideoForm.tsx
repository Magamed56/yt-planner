"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoStage } from "@prisma/client";
import Modal from "@/components/Modal";
import type { VideoRow } from "@/components/VideoList";

const EMPTY_FORM = { title: "", idea: "", script: "", plannedPublishAt: "", videoUrl: "", notes: "" };

export default function AddVideoForm({
  channelId,
  defaultStage,
  onAdded,
}: {
  channelId: string;
  defaultStage: VideoStage;
  onAdded?: (video: VideoRow) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isShort, setIsShort] = useState(true);

  const isDirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM) || !isShort;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    setOpen(false);
    setForm(EMPTY_FORM);
    setIsShort(true);
    setError(null);
  }

  function requestClose() {
    if (isDirty && !confirm("Закрыть форму? Введённые данные будут потеряны.")) return;
    close();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/channels/${channelId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        idea: form.idea.trim() || null,
        script: form.script.trim() || null,
        isShort,
        stage: defaultStage,
        plannedPublishAt: form.plannedPublishAt || null,
        videoUrl: form.videoUrl.trim() || null,
        notes: form.notes.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Ошибка");
      return;
    }
    const created = await res.json();
    close();
    onAdded?.({
      ...created,
      plannedPublishAt: created.plannedPublishAt ? new Date(created.plannedPublishAt) : null,
      publishedAt: created.publishedAt ? new Date(created.publishedAt) : null,
      createdAt: new Date(created.createdAt),
      updatedAt: new Date(created.updatedAt),
      stageEvents: created.stageEvents.map((ev: { createdAt: string }) => ({ ...ev, createdAt: new Date(ev.createdAt) })),
    });
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none transition-all duration-200 focus:border-accent focus:bg-surface-3 focus:ring-1 focus:ring-accent-soft";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        <span>+</span> Видео
      </button>
    );
  }

  return (
    <Modal title="Новое видео" onClose={requestClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="metric-label">Название *</label>
          <input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} className={inputClass} placeholder="Заголовок видео" />
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
          <textarea value={form.script} onChange={(e) => set("script", e.target.value)} className={inputClass} rows={6} placeholder="Можно заполнить позже…" />
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

        {error && <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy || !form.title.trim()} className="btn-primary text-sm">
            {busy ? "Добавляю…" : "Добавить видео"}
          </button>
          <button type="button" onClick={requestClose} className="btn-ghost text-sm">
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}
