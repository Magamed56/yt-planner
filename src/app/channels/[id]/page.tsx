import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { STAGE_SLUGS } from "@/lib/stages";

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = await prisma.channel.findUnique({ where: { id }, select: { id: true } });
  if (!channel) notFound();
  redirect(`/channels/${id}/${STAGE_SLUGS.IDEA}`);
}
