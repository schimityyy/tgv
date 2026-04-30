import { NextResponse } from "next/server";
import { streamFlexibleRouteSearch } from "@/lib/sncf";

const CSV_NUMBER = /^\d+(,\d+)*$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = searchParams.get("origin") ?? "";
  const destination = searchParams.get("destination") ?? "";
  const startDate = searchParams.get("startDate");
  const legCounts = parseNumberCsv(searchParams.get("legCounts"));
  const travelDays = parseNumberCsv(searchParams.get("travelDays"));

  if (!origin.trim() || !destination.trim()) {
    return NextResponse.json({ error: "Origin and destination are required." }, { status: 400 });
  }

  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "startDate must use YYYY-MM-DD format." }, { status: 400 });
  }

  if (!legCounts.length || legCounts.some((value) => value < 1 || value > 4)) {
    return NextResponse.json({ error: "legCounts must contain numbers from 1 to 4." }, { status: 400 });
  }

  if (!travelDays.length || travelDays.some((value) => value < 1 || value > 3)) {
    return NextResponse.json({ error: "travelDays must contain numbers from 1 to 3." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for await (const event of streamFlexibleRouteSearch({
          origin,
          destination,
          startDate,
          legCounts,
          travelDays
        })) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "Unable to search flexible routes."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8"
    }
  });
}

function parseNumberCsv(value: string | null) {
  if (!value || !CSV_NUMBER.test(value)) {
    return [];
  }

  return value.split(",").map(Number);
}
