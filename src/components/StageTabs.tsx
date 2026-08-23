"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { VideoStage } from "@prisma/client";
import { STAGE_LABELS, STAGE_SLUGS, TAB_STAGES } from "@/lib/stages";

export default function StageTabs({
  channelId,
  counts,
  current,
}: {
  channelId: string;
  counts: Record<VideoStage, number>;
  current: VideoStage;
}) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {TAB_STAGES.map((stage) => {
        const href = `/channels/${channelId}/${STAGE_SLUGS[stage]}`;
        const active = stage === current || pathname === href;
        return (
          <Link
            key={stage}
            href={href}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200 ${
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-ink-dim hover:border-line-strong hover:text-ink"
            }`}
          >
            {active && <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />}
            {STAGE_LABELS[stage]}
            <span className="text-ink-faint">{counts[stage] ?? 0}</span>
          </Link>
        );
      })}
    </div>
  );
}
