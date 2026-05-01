import {
  fetchAvailableTrainsBetweenDates,
  stationMatches,
  type TrainAvailability
} from "@/lib/sncf";
import {
  busArrivalMinute,
  busDepartureMinute,
  getBusLegsForDate,
  placeCityKey,
  type BusLeg,
  type BusProvider
} from "@/lib/bus";

export type MultimodalLeg =
  | {
      mode: "train";
      provider: "TGVmax";
      train: TrainAvailability;
    }
  | {
      mode: "bus";
      provider: BusProvider;
      bus: BusLeg;
    };

export type MultimodalRouteOption = {
  id: string;
  legs: MultimodalLeg[];
  busMinutes: number;
  trainMinutes: number;
  waitMinutes: number;
  durationMinutes: number;
  departureDate: string;
  arrivalDate: string;
  score: number;
};

export type MultimodalRoutesPayload = {
  routes: MultimodalRouteOption[];
  checkedAt: string;
  searchedFrom: string;
  searchedTo: string;
};

type WalkLeg =
  | {
      mode: "train";
      id: string;
      origin: string;
      destination: string;
      departureMinute: number;
      arrivalMinute: number;
      durationMinutes: number;
      payload: TrainAvailability;
    }
  | {
      mode: "bus";
      id: string;
      origin: string;
      destination: string;
      departureMinute: number;
      arrivalMinute: number;
      durationMinutes: number;
      payload: BusLeg;
    };

const MAX_RESULTS = 48;
const MAX_WALK_RESULTS = MAX_RESULTS * 8;
const MAX_LEGS = 4;
const MIN_TRANSFER_MINUTES = 35;
const MAX_BRANCHES_PER_STEP = 80;

export async function findMultimodalBridgeRoutes({
  date,
  destination,
  maxBusMinutes = 180,
  maxTravelDays = 2,
  origin,
  providers = [],
  startTime = "00:00"
}: {
  date?: string | null;
  destination: string;
  maxBusMinutes?: number;
  maxTravelDays?: number;
  origin: string;
  providers?: BusProvider[];
  startTime?: string | null;
}): Promise<MultimodalRoutesPayload> {
  const searchDate = date || formatDateInput(new Date());
  const travelDays = Math.max(1, Math.min(maxTravelDays, 3));
  const searchedTo = addDays(searchDate, travelDays - 1);
  const minStartMinute = dateIndex(searchDate) * 1440 + timeToMinutes(startTime || "00:00");
  const trainData = await fetchAvailableTrainsBetweenDates(searchDate, searchedTo, { maxRecords: 7500 });
  const busLegs = providers.length
    ? await fetchBusLegsForDateRange(searchDate, travelDays, providers)
    : [];
  const trainLegs = trainData.records.map(trainToWalkLeg);
  const busWalkLegs = busLegs
    .filter((leg) => leg.durationMinutes <= maxBusMinutes)
    .map(busToWalkLeg);
  const byOriginCity = groupWalkLegsByOriginCity([...trainLegs, ...busWalkLegs]);
  const firstTrainLegs = selectDiverseStartLegs(
    trainLegs.filter((leg) => stationMatches(leg.origin, origin) && leg.departureMinute >= minStartMinute)
  );
  const routes: MultimodalRouteOption[] = [];

  for (const firstLeg of firstTrainLegs) {
    walk([firstLeg], new Set([placeCityKey(firstLeg.origin), placeCityKey(firstLeg.destination)]));
    if (routes.length >= MAX_WALK_RESULTS) {
      break;
    }
  }

  return {
    routes: selectDiverseRoutes(dedupeMultimodalRoutes(routes).sort(compareMultimodalRoutes)),
    checkedAt: trainData.checkedAt,
    searchedFrom: searchDate,
    searchedTo
  };

  function walk(legs: WalkLeg[], visitedCities: Set<string>) {
    const lastLeg = legs[legs.length - 1];

    if (destinationMatches(lastLeg.destination, destination) && isAllowedRoute(legs)) {
      routes.push(buildMultimodalRoute(legs));
      return;
    }

    if (legs.length >= MAX_LEGS || routes.length >= MAX_WALK_RESULTS) {
      return;
    }

    const nextLegs = (byOriginCity.get(placeCityKey(lastLeg.destination)) ?? [])
      .filter((candidate) => isViableNextLeg(candidate, legs, visitedCities))
      .slice(0, MAX_BRANCHES_PER_STEP);

    for (const nextLeg of nextLegs) {
      const nextCity = placeCityKey(nextLeg.destination);
      const nextVisited = new Set(visitedCities);
      nextVisited.add(nextCity);
      walk([...legs, nextLeg], nextVisited);
      if (routes.length >= MAX_WALK_RESULTS) {
        return;
      }
    }
  }

  function isViableNextLeg(candidate: WalkLeg, legs: WalkLeg[], visitedCities: Set<string>) {
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];
    const waitMinutes = candidate.departureMinute - lastLeg.arrivalMinute;

    if (waitMinutes < MIN_TRANSFER_MINUTES) {
      return false;
    }

    if (lastLeg.mode === "bus" && candidate.mode === "bus") {
      return false;
    }

    if (candidate.departureMinute - firstLeg.departureMinute > travelDays * 1440) {
      return false;
    }

    if (candidate.arrivalMinute - firstLeg.departureMinute > travelDays * 1440) {
      return false;
    }

    if (candidate.mode === "bus" && !providers.includes(candidate.payload.provider)) {
      return false;
    }

    const destinationCity = placeCityKey(candidate.destination);
    return !visitedCities.has(destinationCity) || destinationMatches(candidate.destination, destination);
  }
}

function destinationMatches(place: string, destination: string) {
  return stationMatches(place, destination) || placeCityKey(place) === placeCityKey(destination);
}

function isAllowedRoute(legs: WalkLeg[]) {
  const busCount = legs.filter((leg) => leg.mode === "bus").length;
  const trainCount = legs.length - busCount;

  if (legs.length === 1 && busCount === 1) {
    return false;
  }

  return trainCount > 0;
}

async function fetchBusLegsForDateRange(date: string, days: number, providers?: BusProvider[]) {
  const chunks = await Promise.all(
    Array.from({ length: days }, (_, index) => getBusLegsForDate(addDays(date, index), providers))
  );

  return chunks.flat();
}

function buildMultimodalRoute(legs: WalkLeg[]): MultimodalRouteOption {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const busMinutes = legs.reduce((sum, leg) => sum + (leg.mode === "bus" ? leg.durationMinutes : 0), 0);
  const trainMinutes = legs.reduce((sum, leg) => sum + (leg.mode === "train" ? leg.durationMinutes : 0), 0);
  const waitMinutes = legs
    .slice(1)
    .reduce((sum, leg, index) => sum + leg.departureMinute - legs[index].arrivalMinute, 0);
  const durationMinutes = last.arrivalMinute - first.departureMinute;

  return {
    id: legs.map((leg) => leg.id).join("|"),
    legs: legs.map((leg) =>
      leg.mode === "train"
        ? { mode: "train" as const, provider: "TGVmax" as const, train: leg.payload }
        : { mode: "bus" as const, provider: leg.payload.provider, bus: leg.payload }
    ),
    busMinutes,
    trainMinutes,
    waitMinutes,
    durationMinutes,
    departureDate: minuteToDate(first.departureMinute),
    arrivalDate: minuteToDate(last.arrivalMinute),
    score: routeScore(legs, busMinutes, waitMinutes, durationMinutes)
  };
}

function routeScore(legs: WalkLeg[], busMinutes: number, waitMinutes: number, durationMinutes: number) {
  const busCount = legs.filter((leg) => leg.mode === "bus").length;
  return (
    busCount * 1200 +
    legs.length * 180 +
    busMinutes * 4 +
    durationMinutes +
    waitMinutes * 0.8
  );
}

function selectDiverseStartLegs(legs: WalkLeg[]) {
  const byBucket = new Map<number, WalkLeg[]>();

  for (const leg of legs.sort(compareWalkLegs)) {
    const bucket = Math.floor((leg.departureMinute % 1440) / 90);
    const group = byBucket.get(bucket) ?? [];
    if (group.length < 14) {
      group.push(leg);
      byBucket.set(bucket, group);
    }
  }

  return Array.from(byBucket.values()).flat().slice(0, 520);
}

function selectDiverseRoutes(routes: MultimodalRouteOption[]) {
  const selected: MultimodalRouteOption[] = [];
  const seenSimilar = new Set<string>();
  const firstLegUse = new Map<string, number>();
  const tiers = groupRoutesByBusCount(routes);

  for (const tierRoutes of tiers) {
    pickRoundRobinByDeparture(tierRoutes, selected, seenSimilar, firstLegUse, 1);
    if (selected.length >= MAX_RESULTS) {
      return selected.slice(0, MAX_RESULTS);
    }
  }

  for (const tierRoutes of tiers) {
    pickRoundRobinByDeparture(tierRoutes, selected, seenSimilar, firstLegUse, 2);
    if (selected.length >= MAX_RESULTS) {
      break;
    }
  }

  return selected.slice(0, MAX_RESULTS);
}

function groupRoutesByBusCount(routes: MultimodalRouteOption[]) {
  const groups = new Map<number, MultimodalRouteOption[]>();

  for (const route of routes) {
    const busCount = routeBusCount(route);
    const group = groups.get(busCount) ?? [];
    group.push(route);
    groups.set(busCount, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group);
}

function pickRoundRobinByDeparture(
  routes: MultimodalRouteOption[],
  selected: MultimodalRouteOption[],
  seenSimilar: Set<string>,
  firstLegUse: Map<string, number>,
  maxSameFirstLeg: number
) {
  const buckets = new Map<number, MultimodalRouteOption[]>();

  for (const route of routes) {
    const bucket = Math.floor((routeDepartureMinute(route) % 1440) / 120);
    const group = buckets.get(bucket) ?? [];
    group.push(route);
    buckets.set(bucket, group);
  }

  const bucketKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
  let progressed = true;

  while (selected.length < MAX_RESULTS && progressed) {
    progressed = false;

    for (const bucket of bucketKeys) {
      const group = buckets.get(bucket) ?? [];
      const nextIndex = group.findIndex((route) =>
        canSelectRoute(route, seenSimilar, firstLegUse, maxSameFirstLeg)
      );
      if (nextIndex < 0) {
        continue;
      }

      const [route] = group.splice(nextIndex, 1);
      selected.push(route);
      seenSimilar.add(routeSimilarityKey(route));
      const firstLegId = routeFirstLegId(route);
      firstLegUse.set(firstLegId, (firstLegUse.get(firstLegId) ?? 0) + 1);
      progressed = true;

      if (selected.length >= MAX_RESULTS) {
        return;
      }
    }
  }
}

function canSelectRoute(
  route: MultimodalRouteOption,
  seenSimilar: Set<string>,
  firstLegUse: Map<string, number>,
  maxSameFirstLeg: number
) {
  if (seenSimilar.has(routeSimilarityKey(route))) {
    return false;
  }

  return (firstLegUse.get(routeFirstLegId(route)) ?? 0) < maxSameFirstLeg;
}

function routeSimilarityKey(route: MultimodalRouteOption) {
  const departureBucket = Math.floor((routeDepartureMinute(route) % 1440) / 60);
  const durationBucket = Math.floor(route.durationMinutes / 35);
  return [
    routeBusCount(route),
    route.legs.length,
    departureBucket,
    durationBucket,
    route.legs.map((leg) => leg.mode).join("-")
  ].join(":");
}

function routeBusCount(route: MultimodalRouteOption) {
  return route.legs.filter((leg) => leg.mode === "bus").length;
}

function routeFirstLegId(route: MultimodalRouteOption) {
  const firstLeg = route.legs[0];
  return firstLeg.mode === "train" ? firstLeg.train.id : firstLeg.bus.id;
}

function trainToWalkLeg(train: TrainAvailability): WalkLeg {
  const departure = trainDepartureMinute(train);
  const arrival = trainArrivalMinute(train);

  return {
    mode: "train",
    id: train.id,
    origin: train.origin,
    destination: train.destination,
    departureMinute: departure,
    arrivalMinute: arrival,
    durationMinutes: arrival - departure,
    payload: train
  };
}

function busToWalkLeg(bus: BusLeg): WalkLeg {
  return {
    mode: "bus",
    id: bus.id,
    origin: bus.origin,
    destination: bus.destination,
    departureMinute: busDepartureMinute(bus),
    arrivalMinute: busArrivalMinute(bus),
    durationMinutes: bus.durationMinutes,
    payload: bus
  };
}

function groupWalkLegsByOriginCity(legs: WalkLeg[]) {
  const groups = new Map<string, WalkLeg[]>();

  for (const leg of legs) {
    const key = placeCityKey(leg.origin);
    const group = groups.get(key);
    if (group) {
      group.push(leg);
    } else {
      groups.set(key, [leg]);
    }
  }

  for (const group of groups.values()) {
    group.sort(compareWalkLegs);
  }

  return groups;
}

function dedupeMultimodalRoutes(routes: MultimodalRouteOption[]) {
  return Array.from(new Map(routes.map((route) => [route.id, route])).values());
}

function compareMultimodalRoutes(a: MultimodalRouteOption, b: MultimodalRouteOption) {
  return (
    routeBusCount(a) - routeBusCount(b) ||
    a.durationMinutes - b.durationMinutes ||
    a.legs.length - b.legs.length ||
    a.waitMinutes - b.waitMinutes ||
    a.busMinutes - b.busMinutes ||
    a.score - b.score ||
    routeDepartureMinute(a) - routeDepartureMinute(b)
  );
}

function compareWalkLegs(a: WalkLeg, b: WalkLeg) {
  return (
    a.departureMinute - b.departureMinute ||
    a.durationMinutes - b.durationMinutes ||
    (a.mode === "train" ? 0 : 1) - (b.mode === "train" ? 0 : 1)
  );
}

function routeDepartureMinute(route: MultimodalRouteOption) {
  const firstLeg = route.legs[0];
  return firstLeg.mode === "train" ? trainDepartureMinute(firstLeg.train) : busDepartureMinute(firstLeg.bus);
}

function trainDepartureMinute(train: TrainAvailability) {
  return dateIndex(train.date) * 1440 + timeToMinutes(train.departureTime);
}

function trainArrivalMinute(train: TrainAvailability) {
  return (
    dateIndex(train.date) * 1440 +
    timeToMinutes(train.arrivalTime) +
    (timeToMinutes(train.arrivalTime) <= timeToMinutes(train.departureTime) ? 1440 : 0)
  );
}

function minuteToDate(minute: number) {
  return new Date(Math.floor(minute / 1440) * 86400000).toISOString().slice(0, 10);
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

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}
