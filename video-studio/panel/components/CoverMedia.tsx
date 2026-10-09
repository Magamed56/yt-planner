"use client";
// Картинка ролика в ленте, календаре и карточке: обложка (YouTube или из релиза). Обложки нет,
// но в релизе есть видео (залито с компьютера без cover.jpg) — кадр из видео на 1-й секунде.
// Ничего не вышло — fallback (плитка с кодом).
import { useEffect, useRef, useState } from "react";

// Кадр грузится, только когда плитка рядом с экраном: видео идёт через функцию панели.
function Frame({ src, className, onError }: { src: string; className?: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // #t=1 и preload="metadata" — так и Safari на iPhone показывает кадр, не запуская видео.
  return <video ref={ref} className={`frame ${className ?? ""}`} src={near ? `${src}#t=1` : undefined} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" onError={onError} />;
}

export default function CoverMedia({
  src,
  video,
  className,
  fallback = null,
  onFail,
}: {
  src: string | null;
  video?: string | null;
  className?: string;
  fallback?: React.ReactNode;
  onFail?: () => void; // ни картинка, ни кадр не открылись
}) {
  const [failed, setFailed] = useState<"img" | "all" | null>(src || video ? null : "all");
  const giveUp = () => {
    setFailed("all");
    onFail?.();
  };
  if (src && !failed) {
    return <img className={className} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => (video ? setFailed("img") : giveUp())} />;
  }
  if (video && failed !== "all") return <Frame src={video} className={className} onError={giveUp} />;
  return <>{fallback}</>;
}

// Видео ролика для кадра-заглушки: если обложки нет или она не открылась.
export const frameOf = (row: { release: { mp4: { id: number } } | null }) => (row.release ? `/api/asset/${row.release.mp4.id}/file` : null);
