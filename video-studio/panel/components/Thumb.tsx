"use client";
import CoverMedia from "./CoverMedia";

// Обложка ролика: с YouTube или из релиза, без неё — кадр из видео релиза. Ничего нет (или
// подписанная ссылка YouTube устарела, пока страница открыта) — плитка с кодом.
// Обычный <img>: внешние картинки без оптимизатора Vercel — он не нужен и тратит лимит тарифа.
export default function Thumb({ src, video = null, code, className = "" }: { src: string | null; video?: string | null; code: string; className?: string }) {
  const empty = (
    <span className={`thumb empty ${className}`} aria-hidden>
      {code}
    </span>
  );
  return <CoverMedia src={src} video={video} className={`thumb ${className}`} fallback={empty} />;
}
