"use client";
import { useState } from "react";

// Обложка ролика: с YouTube или из релиза. Картинки нет (или подписанная ссылка YouTube
// устарела, пока страница открыта) — плитка с кодом.
export default function Thumb({ src, code, className = "" }: { src: string | null; code: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className={`thumb empty ${className}`} aria-hidden>
        {code}
      </span>
    );
  }
  // Обычный <img>: внешние картинки без оптимизатора Vercel — он не нужен и тратит лимит тарифа.
  return <img className={`thumb ${className}`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
