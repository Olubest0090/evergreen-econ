import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { computeNet } from "@/lib/books";

export const dynamic = "force-dynamic";

const err = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function GET() {
  const staff = await requireStaff();

  if (!staff) return err("Forbidden", 403);

  try {
    return NextResponse.json(await computeNet());
  } catch (error) {
    console.error(
      "Books failed:",
      error instanceof Error ? error.message : error
    );

    return err("Could not work out the net", 500);
  }
}

export async function POST() {
  return err("Manual offshore book entries are disabled.", 405);
}
