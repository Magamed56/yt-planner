"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const SIZE_CLASS = {
  sm: "max-w-xs",
  md: "max-w-sm",
  lg: "max-w-2xl",
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  title,
  onClose,
  children,
  size = "sm",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose обычно приходит как свежее замыкание на каждый рендер родителя
  // (requestClose и т.п.) — если положить его прямо в deps ниже, эффект
  // перезапускался бы на каждое нажатие клавиши где угодно в форме и заново
  // воровал фокус на первое поле модалки. Ref всегда даёт актуальную ссылку
  // без перезапуска эффекта.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // Фокус внутрь модалки при открытии (первое поле ввода — так удобнее
  // всего) и Escape/Tab-ловушка для клавиатурной навигации.
  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstField = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstField ?? panel)?.focus();

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (ev.key === "Tab" && panel) {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${SIZE_CLASS[size]} max-h-[90vh] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-xl outline-none`}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-ink line-clamp-1 pr-2">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint hover:text-ink text-lg leading-none shrink-0"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
