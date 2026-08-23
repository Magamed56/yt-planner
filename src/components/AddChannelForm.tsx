"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";

export default function AddChannelForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");

  function close() {
    setOpen(false);
    setName("");
    setNiche("");
    setError(null);
  }

  function requestClose() {
    if ((name || niche) && !confirm("Закрыть форму? Введённые данные будут потеряны.")) return;
    close();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), niche: niche.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Ошибка");
      return;
    }
    const channel = await res.json();
    close();
    router.push(`/channels/${channel.id}`);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        <span>+</span> Канал
      </button>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none transition-all duration-200 focus:border-accent focus:bg-surface-3 focus:ring-1 focus:ring-accent-soft";

  return (
    <Modal title="Новый канал" onClose={requestClose} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="metric-label">Название канала *</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Мой канал" />
        </div>
        <div>
          <label className="metric-label">Ниша</label>
          <input value={niche} onChange={(e) => setNiche(e.target.value)} className={inputClass} placeholder="Например: обзоры техники" />
        </div>
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">{error}</div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-sm">
            {busy ? "Создаю…" : "Создать"}
          </button>
          <button type="button" onClick={requestClose} className="btn-ghost text-sm">
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}
