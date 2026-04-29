import { NextResponse } from "next/server";
import { findRouteOptions, type RouteSearchMode } from "@/lib/sncf";

const ROUTE_MODES = new Set(["specific", "flexible", "range"]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const destination = searchParams.get("destination") ?? "";
    const mode = searchParams.get("mode") ?? "specific";
    const date = searchParams.get("date");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const maxLegs = Number(searchParams.get("maxLegs") ?? "2");

    if (!origin.trim() || !destination.trim()) {
      return NextResponse.json({ error: "Origin and destination are required." }, { status: 400 });
    }

    if (!ROUTE_MODES.has(mode)) {
      return NextResponse.json({ error: "Invalid route search mode." }, { status: 400 });
    }

    for (const value of [date, startDate, endDate]) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return NextResponse.json({ error: "Dates must use YYYY-MM-DD format." }, { status: 400 });
      }
    }

    if (!Number.isInteger(maxLegs) || maxLegs < 1 || maxLegs > 4) {
      return NextResponse.json({ error: "maxLegs must be between 1 and 4." }, { status: 400 });
    }

    const data = await findRouteOptions({
      origin,
      destination,
      mode: mode as RouteSearchMode,
      date,
      startDate,
      endDate,
      maxLegs
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to search SNCF routes."
      },
      { status: 502 }
    );
  }
}
