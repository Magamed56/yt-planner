import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const home = new URL("/", req.url);

  if (error) {
    home.searchParams.set("youtube_error", error);
    return NextResponse.redirect(home);
  }
  if (!code) {
    home.searchParams.set("youtube_error", "no_code");
    return NextResponse.redirect(home);
  }

  try {
    await exchangeCodeForTokens(code);
    home.searchParams.set("youtube_connected", "1");
  } catch (e) {
    home.searchParams.set("youtube_error", e instanceof Error ? e.message : "unknown");
  }
  return NextResponse.redirect(home);
}
