import { NextResponse } from "next/server";
import { findReachableRoutes, type ReachableDirection } from "@/lib/sncf";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const station = searchParams.get("station") ?? "";
    const direction = searchParams.get("direction") ?? "outbound";
    const date = searchParams.get("date");
    const maxLegs = Number(searchParams.get("maxLegs") ?? "3");

    if (!station.trim()) {
      return NextResponse.json({ error: "Station is required." }, { status: 400 });
    }

    if (direction !== "outbound" && direction !== "inbound") {
      return NextResponse.json({ error: "Invalid direction." }, { status: 400 });
    }

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    if (!Number.isInteger(maxLegs) || maxLegs < 1 || maxLegs > 3) {
      return NextResponse.json({ error: "maxLegs must be between 1 and 3." }, { status: 400 });
    }

    const data = await findReachableRoutes({
      direction: direction as ReachableDirection,
      station,
      date,
      maxLegs
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to search reachable routes."
      },
      { status: 502 }
    );
  }
}
