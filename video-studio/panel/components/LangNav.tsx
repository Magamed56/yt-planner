"use client";
// Пункты меню каналов на других языках («English» → /lang/en). Список считает сервер из
// channels/<язык>.json (lib/lang-channels.ts) и отдаёт через корневой layout — сами файлы
// каналов в браузер не попадают, а меню одинаковое на всех страницах.
import { createContext, useContext } from "react";
import type { NavLang } from "@/lib/lang-channels";

const LangNavContext = createContext<NavLang[]>([]);

export function LangNavProvider({ langs, children }: { langs: NavLang[]; children: React.ReactNode }) {
  return <LangNavContext.Provider value={langs}>{children}</LangNavContext.Provider>;
}

export const useLangNav = (): NavLang[] => useContext(LangNavContext);
