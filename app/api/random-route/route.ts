import { NextResponse } from "next/server";
import { findRandomTrip } from "@/lib/sncf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const startAt = searchParams.get("startAt") ?? "";
    const endAt = searchParams.get("endAt") ?? "";
    const cityCount = Number(searchParams.get("cityCount") ?? "3");
    const randomCityCount = searchParams.get("randomCityCount") === "true";
    const excludeTripIds = searchParams.getAll("excludeTripId").filter(Boolean);
    const excludeCities = searchParams.getAll("excludeCity").filter(Boolean);

    if (!origin.trim()) {
      return NextResponse.json({ error: "Origin is required." }, { status: 400 });
    }

    if (!isDateTimeInput(startAt) || !isDateTimeInput(endAt)) {
      return NextResponse.json({ error: "Dates must use YYYY-MM-DDTHH:mm format." }, { status: 400 });
    }

    const maxCityCount = maxCitiesForWindow(startAt, endAt);

    if (!randomCityCount && (!Number.isInteger(cityCount) || cityCount < 1 || cityCount > maxCityCount)) {
      return NextResponse.json(
        { error: `cityCount must be between 1 and ${maxCityCount}.` },
        { status: 400 }
      );
    }

    const data = await findRandomTrip({
      origin,
      startAt,
      endAt,
      cityCount,
      randomCityCount,
      excludeTripIds,
      excludeCities
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate a random trip."
      },
      { status: 502 }
    );
  }
}

function isDateTimeInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

function maxCitiesForWindow(startAt: string, endAt: string) {
  const startDate = Date.parse(`${startAt.slice(0, 10)}T00:00:00`);
  const endDate = Date.parse(`${endAt.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(startDate) || Number.isNaN(endDate) || endDate < startDate) {
    return 1;
  }

  return Math.max(1, Math.floor((endDate - startDate) / 86_400_000) + 1);
}
