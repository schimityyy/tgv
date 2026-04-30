import { describe, expect, it } from "vitest";
import {
  findFlexibleRoutesInRecords,
  filterByDate,
  filterByOrigin,
  getOriginSuggestions,
  isAvailableStatus,
  normalizeTgvmaxResponse,
  type TrainAvailability
} from "./sncf";

describe("SNCF TGVMax normalization", () => {
  it("keeps only available trains and sorts by date and departure", () => {
    const payload = normalizeTgvmaxResponse(
      {
        total_count: 3,
        results: [
          {
            date: "2026-05-03",
            train_no: "8421",
            origine: "PARIS (intramuros)",
            destination: "LYON PART DIEU",
            heure_depart: "18:14",
            heure_arrivee: "20:11",
            od_happy_card: "OUI"
          },
          {
            date: "2026-05-02",
            train_no: "6201",
            origine: "PARIS (intramuros)",
            destination: "MARSEILLE ST CHARLES",
            heure_depart: "07:38",
            heure_arrivee: "10:56",
            od_happy_card: "OUI"
          },
          {
            date: "2026-05-01",
            train_no: "6603",
            origine: "PARIS (intramuros)",
            destination: "LYON PART DIEU",
            heure_depart: "09:00",
            heure_arrivee: "10:58",
            od_happy_card: "NON"
          }
        ]
      },
      new Date("2026-04-29T12:00:00Z")
    );

    expect(payload.totalCount).toBe(3);
    expect(payload.checkedAt).toBe("2026-04-29T12:00:00.000Z");
    expect(payload.records).toHaveLength(2);
    expect(payload.records.map((record) => record.trainNo)).toEqual(["6201", "8421"]);
  });

  it("deduplicates repeated rows for the same train", () => {
    const payload = normalizeTgvmaxResponse({
      results: [
        {
          date: "2026-05-03",
          train_no: "8421",
          origine: "PARIS (intramuros)",
          destination: "LYON (intramuros)",
          heure_depart: "18:14",
          heure_arrivee: "20:11",
          od_happy_card: "OUI"
        },
        {
          date: "2026-05-03",
          train_no: "8421",
          origine: "PARIS (intramuros)",
          destination: "LYON (intramuros)",
          heure_depart: "18:14",
          heure_arrivee: "20:11",
          od_happy_card: "OUI"
        }
      ]
    });

    expect(payload.records).toHaveLength(1);
  });

  it("handles v1-style records and missing required fields safely", () => {
    const payload = normalizeTgvmaxResponse({
      records: [
        {
          fields: {
            date: "2026-05-04",
            train_no: "5520",
            origine: "NANTES",
            destination: "PARIS (intramuros)",
            heure_depart: "13:21:00",
            heure_arrivee: "15:40:00",
            od_happy_card: "Oui"
          }
        },
        {
          fields: {
            date: "2026-05-04",
            train_no: "5522",
            origine: "NANTES",
            destination: "",
            heure_depart: "14:21:00",
            heure_arrivee: "16:40:00",
            od_happy_card: "Oui"
          }
        }
      ]
    });

    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].departureTime).toBe("13:21");
  });
});

describe("SNCF filtering helpers", () => {
  const records = normalizeTgvmaxResponse({
    results: [
      {
        date: "2026-05-02",
        train_no: "1",
        origine: "PARIS (intramuros)",
        destination: "LYON PART DIEU",
        heure_depart: "08:00",
        heure_arrivee: "10:00",
        od_happy_card: "OUI"
      },
      {
        date: "2026-05-03",
        train_no: "2",
        origine: "NÎMES",
        destination: "PARIS (intramuros)",
        heure_depart: "09:00",
        heure_arrivee: "12:00",
        od_happy_card: "OUI"
      }
    ]
  }).records;

  it("matches origins exactly after normalizing accents and case", () => {
    expect(filterByOrigin(records, "nimes")).toHaveLength(1);
  });

  it("filters by date when provided", () => {
    expect(filterByDate(records, "2026-05-02")).toHaveLength(1);
    expect(filterByDate(records)).toHaveLength(2);
  });

  it("returns unique sorted origin suggestions", () => {
    expect(getOriginSuggestions(records, "par")).toEqual(["PARIS (intramuros)"]);
    expect(isAvailableStatus("available")).toBe(true);
    expect(isAvailableStatus("NON")).toBe(false);
  });
});

describe("Flexible route brute-force search", () => {
  it("stops on the first departure day with routes and keeps the best options", () => {
    const records = [
      train("2026-05-03", "1", "PARIS (intramuros)", "LYON PART DIEU", "08:00", "10:00"),
      train("2026-05-04", "2", "LYON PART DIEU", "DIJON", "09:00", "10:30"),
      train("2026-05-04", "3", "DIJON", "NANTES", "12:00", "15:00"),
      train("2026-05-05", "4", "PARIS (intramuros)", "NANTES", "07:00", "10:00")
    ];

    const events = Array.from(findFlexibleRoutesInRecords(records, {
      origin: "PARIS (all stations)",
      destination: "NANTES",
      startDate: "2026-05-01",
      legCounts: [1, 3],
      travelDays: [1, 2],
      limit: 10
    }));
    const routes = events.flatMap((event) => event.type === "route" ? [event.route] : []);

    expect(routes.map((route) => route.legs.map((leg) => leg.trainNo))).toEqual([
      ["1", "2", "3"]
    ]);
  });
});

function train(
  date: string,
  trainNo: string,
  origin: string,
  destination: string,
  departureTime: string,
  arrivalTime: string
): TrainAvailability {
  return {
    id: [date, trainNo, origin, destination, departureTime].join(":"),
    date,
    trainNo,
    entity: "TGV",
    axe: "",
    originCode: "",
    destinationCode: "",
    origin,
    destination,
    departureTime,
    arrivalTime,
    status: "OUI"
  };
}
