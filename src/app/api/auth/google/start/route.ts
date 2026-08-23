import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google";

// GET, а не POST: это должен быть переход браузера на google.com/consent, не
// fetch-запрос — обычная ссылка/window.location, которую браузер реально
// переходит.
export async function GET() {
  return NextResponse.redirect(getAuthUrl());
}
