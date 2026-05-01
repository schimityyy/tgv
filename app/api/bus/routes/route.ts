import { NextResponse } from "next/server";
import { findBusRouteOptions, normalizeBusProviders } from "@/lib/bus";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const destination = searchParams.get("destination") ?? "";
    const date = searchParams.get("date");
    const providers = normalizeBusProviders(searchParams.get("providers"));
    const maxLegs = Number(searchParams.get("maxLegs") ?? "2");

    if (!origin.trim() || !destination.trim()) {
      return NextResponse.json({ error: "Origin and destination are required." }, { status: 400 });
    }

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    if (!Number.isInteger(maxLegs) || maxLegs < 1 || maxLegs > 2) {
      return NextResponse.json({ error: "maxLegs must be between 1 and 2." }, { status: 400 });
    }

    const data = await findBusRouteOptions({
      origin,
      destination,
      date,
      providers,
      maxLegs
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to search bus routes."
      },
      { status: 502 }
    );
  }
}
