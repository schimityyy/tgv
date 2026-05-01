import { NextResponse } from "next/server";
import { fetchBusLegs, normalizeBusProviders } from "@/lib/bus";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const destination = searchParams.get("destination") ?? "";
    const date = searchParams.get("date");
    const direction = searchParams.get("direction") ?? "outbound";
    const providers = normalizeBusProviders(searchParams.get("providers"));

    if (direction !== "outbound" && direction !== "inbound") {
      return NextResponse.json({ error: "Invalid bus search direction." }, { status: 400 });
    }

    if (direction === "outbound" && !origin.trim()) {
      return NextResponse.json({ error: "Origin is required." }, { status: 400 });
    }

    if (direction === "inbound" && !destination.trim()) {
      return NextResponse.json({ error: "Destination is required." }, { status: 400 });
    }

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    const data = await fetchBusLegs({
      date,
      direction,
      providers,
      station: direction === "inbound" ? destination : origin
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load bus trips."
      },
      { status: 502 }
    );
  }
}
