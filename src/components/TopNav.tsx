"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import YoutubeConnectButton from "@/components/YoutubeConnectButton";

export default function TopNav({ channels }: { channels: { id: string; name: string }[] }) {
  const pathname = usePathname();

  const linkClass = (active: boolean) =>
    `text-sm whitespace-nowrap font-medium transition-all duration-300 pb-2.5 border-b-2 ${
      active
        ? "text-accent border-accent"
        : "text-ink-dim border-transparent hover:text-ink hover:border-line-strong"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10 py-5 flex items-center gap-12">
        <Link href="/" className="inline-flex items-center gap-3 hover:opacity-80 transition-opacity duration-200 flex-shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent">
            <span className="text-sm font-bold text-white">▶</span>
          </div>
          <span className="text-lg font-bold text-ink">YT Planner</span>
        </Link>

        <nav className="flex items-center gap-8 overflow-x-auto flex-1 pb-1">
          {channels.map((c) => {
            const href = `/channels/${c.id}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link key={c.id} href={href} className={linkClass(active)}>
                {c.name}
              </Link>
            );
          })}
        </nav>

        <YoutubeConnectButton />
      </div>
    </header>
  );
}
