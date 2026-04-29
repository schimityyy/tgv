import { NextResponse } from "next/server";
import { fetchAvailableTrains, fetchAvailableTrainsToDestination } from "@/lib/sncf";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const destination = searchParams.get("destination") ?? "";
    const date = searchParams.get("date");
    const direction = searchParams.get("direction") ?? "outbound";
    const nightOnly = searchParams.get("nightOnly") === "true";

    if (direction === "outbound" && !origin.trim()) {
      return NextResponse.json({ error: "Origin is required." }, { status: 400 });
    }

    if (direction === "inbound" && !destination.trim()) {
      return NextResponse.json({ error: "Destination is required." }, { status: 400 });
    }

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    const data =
      direction === "inbound"
        ? await fetchAvailableTrainsToDestination(destination, date, { nightOnly })
        : await fetchAvailableTrains(origin, date, { nightOnly });

    return NextResponse.json({
      trains: data.records,
      checkedAt: data.checkedAt,
      totalCount: data.records.length
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load SNCF trains."
      },
      { status: 502 }
    );
  }
}
