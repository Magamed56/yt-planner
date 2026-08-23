import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

// Единый способ превратить нарушение уникальности (P2002) в понятный ответ
// вместо необработанного 500.
export function uniqueConstraintResponse(e: unknown, message: string): NextResponse | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return null;
}
