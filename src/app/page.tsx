import Link from "next/link";
import { prisma } from "@/lib/prisma";
import AddChannelForm from "@/components/AddChannelForm";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ youtube_connected?: string; youtube_error?: string }>;
}) {
  const { youtube_connected, youtube_error } = await searchParams;
  const channels = await prisma.channel.findMany({
    include: { videos: true },
    orderBy: { name: "asc" },
  });

  const rows = channels.map((c) => ({
    channel: c,
    total: c.videos.length,
    published: c.videos.filter((v) => v.stage === "PUBLISHED").length,
    inProgress: c.videos.filter((v) => v.stage !== "PUBLISHED" && v.stage !== "REJECTED").length,
  }));

  return (
    <main className="mx-auto max-w-[1400px] px-6 md:px-10 py-[clamp(40px,8vh,80px)]">
      {youtube_connected && (
        <div className="mb-6 rounded-lg bg-success-soft border border-success/30 px-4 py-2.5 text-sm text-success">
          YouTube-канал подключён.
        </div>
      )}
      {youtube_error && (
        <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-sm text-red-300">
          Не удалось подключить YouTube: {youtube_error}
        </div>
      )}
      <div className="mb-12">
        <h1 className="text-[clamp(36px,6vw,56px)] text-ink mb-3 font-bold">YT Planner</h1>
        <p className="text-ink-dim leading-relaxed max-w-[60ch] text-base">
          Свои каналы, идеи и видео на пути от идеи до публикации.
        </p>
      </div>

      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-lg font-display font-bold text-ink">Каналы</h2>
        <AddChannelForm />
      </div>

      <div className="space-y-3">
        {rows.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-ink-faint mb-4">Ещё нет ни одного канала</p>
            <AddChannelForm />
          </div>
        ) : (
          rows.map(({ channel, total, published, inProgress }) => (
            <Link
              key={channel.id}
              href={`/channels/${channel.id}`}
              className="card group p-4 flex items-center justify-between gap-6 flex-wrap"
            >
              <div className="flex-1 min-w-[180px]">
                <div className="font-display font-bold text-lg text-ink group-hover:text-accent transition-colors duration-300">
                  {channel.name}
                </div>
                <div className="mt-1 text-sm text-ink-faint">{channel.niche ?? "Ниша не указана"}</div>
              </div>
              <div className="flex gap-6 shrink-0">
                <Stat label="Всего видео" value={total.toString()} />
                <Stat label="В работе" value={inProgress.toString()} />
                <Stat label="Опубликовано" value={published.toString()} accent />
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint whitespace-nowrap">{label}</div>
      <div className={`text-sm font-semibold whitespace-nowrap ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    </div>
  );
}
