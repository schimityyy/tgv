import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { BUS_CACHE_TAG, normalizeBusProviders, refreshBusData } from "@/lib/bus";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providers = normalizeBusProviders(searchParams.get("providers"));
    revalidateTag(BUS_CACHE_TAG, "max");
    const data = await refreshBusData(providers);

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to refresh bus GTFS data."
      },
      { status: 502 }
    );
  }
}
