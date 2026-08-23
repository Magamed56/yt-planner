"use client";

import { useEffect, useState } from "react";

type Status = { connected: true; channelTitle: string | null } | { connected: false } | null;

export default function YoutubeConnectButton() {
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    fetch("/api/auth/google")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  async function disconnect() {
    if (!confirm("Отключить YouTube-аккаунт? Автозагрузка перестанет работать, пока не подключишь заново.")) return;
    await fetch("/api/auth/google", { method: "DELETE" });
    setStatus({ connected: false });
  }

  if (!status) return null;

  if (status.connected) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title="Нажми, чтобы отключить"
        className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-400 transition-colors shrink-0"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
        YouTube: {status.channelTitle ?? "подключено"}
      </button>
    );
  }

  return (
    <a href="/api/auth/google/start" className="btn-ghost text-xs shrink-0">
      Подключить YouTube
    </a>
  );
}
