import { NextResponse } from "next/server";
import {
  fetchAvailableTrains,
  stationMatches,
  type TrainAvailability
} from "@/lib/sncf";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get("origin") ?? "";
    const destination = searchParams.get("destination") ?? "";
    const date = searchParams.get("date") ?? "";
    const departureTime = searchParams.get("departureTime") ?? "";
    const arrivalTime = searchParams.get("arrivalTime") ?? "";
    const nightOnly = searchParams.get("nightOnly") === "true";

    if (!origin.trim() || !destination.trim()) {
      return NextResponse.json({ error: "Origin and destination are required." }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    if (!/^\d{2}:\d{2}$/.test(departureTime) || !/^\d{2}:\d{2}$/.test(arrivalTime)) {
      return NextResponse.json({ error: "Departure and arrival times must use HH:mm format." }, { status: 400 });
    }

    const arrivalMinute = absoluteArrivalMinute(date, departureTime, arrivalTime);
    const arrivalDayIndex = Math.floor(arrivalMinute / 1440);
    const returnDates = [date, addDays(date, 1), addDays(date, 2), addDays(date, 3), addDays(date, 4)];
    const returnData = await Promise.all(
      returnDates.map((returnDate) => fetchAvailableTrains(destination, returnDate, { nightOnly }))
    );
    const returns = returnData
      .flatMap((item) => item.records)
      .filter((train) => {
        return (
          stationMatches(train.destination, origin) &&
          absoluteDepartureMinute(train) >= arrivalMinute + 30
        );
      })
      .sort(compareDeparture)
      .slice(0, 8)
      .map((train) => ({
        arrivalTime: train.arrivalTime,
        date: train.date,
        departureTime: train.departureTime,
        sameDay: dateIndex(train.date) === arrivalDayIndex,
        trainNo: train.trainNo
      }));

    return NextResponse.json({ returns });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Return trains could not be loaded."
      },
      { status: 502 }
    );
  }
}

function compareDeparture(a: TrainAvailability, b: TrainAvailability) {
  return absoluteDepartureMinute(a) - absoluteDepartureMinute(b);
}

function absoluteDepartureMinute(train: TrainAvailability) {
  return absoluteMinute(train.date, train.departureTime);
}

function absoluteArrivalMinute(date: string, departureTime: string, arrivalTime: string) {
  const departure = timeToMinutes(departureTime);
  const arrival = timeToMinutes(arrivalTime);
  return dateIndex(date) * 1440 + arrival + (arrival <= departure ? 1440 : 0);
}

function absoluteMinute(date: string, time: string) {
  return dateIndex(date) * 1440 + timeToMinutes(time);
}

function dateIndex(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function timeToMinutes(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
