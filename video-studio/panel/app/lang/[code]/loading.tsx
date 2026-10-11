"use client";
// Скелет страницы канала на другом языке. loading.tsx параметров не получает — язык (для
// подсвеченного пункта меню) берём из адреса.
import { useParams } from "next/navigation";
import PageSkeleton from "@/components/PageSkeleton";

export default function Loading() {
  const { code } = useParams<{ code: string }>();
  return <PageSkeleton active={`lang:${(code ?? "").toLowerCase()}`} kind="list" />;
}
