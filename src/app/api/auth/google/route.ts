import { NextResponse } from "next/server";
import { getConnectionStatus, disconnectGoogle } from "@/lib/google";

export async function GET() {
  const status = await getConnectionStatus();
  return NextResponse.json(status);
}

export async function DELETE() {
  await disconnectGoogle();
  return NextResponse.json({ ok: true });
}
