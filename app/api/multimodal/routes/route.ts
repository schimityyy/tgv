import { NextResponse } from "next/server";
import type { BusProvider } from "@/lib/bus";
import { findMultimodalBridgeRoutes } from "@/lib/multimodal";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const destination = searchParams.get("destination") ?? "";
    const date = searchParams.get("date");
    const startTime = searchParams.get("startTime") ?? "00:00";
    const providers = parseOptionalBusProviders(searchParams.get("providers"));
    const maxBusMinutes = Number(searchParams.get("maxBusMinutes") ?? "180");
    const maxTravelDays = Number(searchParams.get("maxTravelDays") ?? "2");

    if (!origin.trim() || !destination.trim()) {
      return NextResponse.json({ error: "Origin and destination are required." }, { status: 400 });
    }

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    if (!/^\d{2}:\d{2}$/.test(startTime)) {
      return NextResponse.json({ error: "startTime must use HH:MM format." }, { status: 400 });
    }

    if (!Number.isFinite(maxBusMinutes) || maxBusMinutes < 30 || maxBusMinutes > 720) {
      return NextResponse.json({ error: "maxBusMinutes must be between 30 and 720." }, { status: 400 });
    }

    if (!Number.isInteger(maxTravelDays) || maxTravelDays < 1 || maxTravelDays > 3) {
      return NextResponse.json({ error: "maxTravelDays must be between 1 and 3." }, { status: 400 });
    }

    const data = await findMultimodalBridgeRoutes({
      origin,
      destination,
      date,
      startTime,
      providers,
      maxBusMinutes,
      maxTravelDays
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to search advanced routes."
      },
      { status: 502 }
    );
  }
}

function parseOptionalBusProviders(value: string | null): BusProvider[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is BusProvider => item === "flixbus" || item === "blablacar")
    )
  );
}
