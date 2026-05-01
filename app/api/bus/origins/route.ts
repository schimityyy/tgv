import { NextResponse } from "next/server";
import { fetchBusStationSuggestions, normalizeBusProviders } from "@/lib/bus";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const providers = normalizeBusProviders(searchParams.get("providers"));
    const data = await fetchBusStationSuggestions("origin", query, providers);

    return NextResponse.json({
      origins: data.origins,
      checkedAt: data.checkedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load bus origins."
      },
      { status: 502 }
    );
  }
}
