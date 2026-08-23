import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { prisma } from "@/lib/prisma";
import TopNav from "@/components/TopNav";
import "./globals.css";

const body = Inter({
  variable: "--font-body",
  subsets: ["latin", "cyrillic"],
});

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "YT Planner",
  description: "Идеи, сценарии и публикация видео по каналам",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const channels = await prisma.channel.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <html lang="ru" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-canvas text-ink font-sans">
        <TopNav channels={channels} />
        {children}
      </body>
    </html>
  );
}
