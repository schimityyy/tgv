import { NextResponse } from "next/server";
import { fetchDestinationSuggestions } from "@/lib/sncf";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const data = await fetchDestinationSuggestions(query);

    return NextResponse.json({
      destinations: data.origins,
      checkedAt: data.checkedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load SNCF destinations."
      },
      { status: 502 }
    );
  }
}
