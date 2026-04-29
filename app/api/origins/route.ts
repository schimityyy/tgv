import { NextResponse } from "next/server";
import { fetchOriginSuggestions } from "@/lib/sncf";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const data = await fetchOriginSuggestions(query);

    return NextResponse.json({
      origins: data.origins,
      checkedAt: data.checkedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load SNCF origins."
      },
      { status: 502 }
    );
  }
}
