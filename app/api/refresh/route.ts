import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { fetchTgvmaxData, SNCF_CACHE_TAG } from "@/lib/sncf";

export async function POST() {
  try {
    revalidateTag(SNCF_CACHE_TAG);
    const data = await fetchTgvmaxData({ refresh: true });

    return NextResponse.json({
      ok: true,
      checkedAt: data.checkedAt,
      totalCount: data.totalCount
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to refresh SNCF data."
      },
      { status: 502 }
    );
  }
}
