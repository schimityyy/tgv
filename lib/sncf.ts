export const SNCF_CACHE_TAG = "sncf-tgvmax";

const SNCF_API_URL =
  "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax/records";

const SELECT_FIELDS = [
  "date",
  "train_no",
  "entity",
  "axe",
  "origine_iata",
  "destination_iata",
  "origine",
  "destination",
  "heure_depart",
  "heure_arrivee",
  "od_happy_card"
].join(",");

const PAGE_SIZE = 100;

export type RawTgvmaxRecord = Partial<{
  date: string;
  train_no: string | number;
  entity: string;
  axe: string;
  origine_iata: string;
  destination_iata: string;
  origine: string;
  destination: string;
  heure_depart: string;
  heure_arrivee: string;
  od_happy_card: string;
}>;

export type TrainAvailability = {
  id: string;
  date: string;
  trainNo: string;
  entity: string;
  axe: string;
  originCode: string;
  destinationCode: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  status: string;
};

export type TgvmaxPayload = {
  records: TrainAvailability[];
  totalCount: number;
  checkedAt: string;
};

export type OriginSuggestionsPayload = {
  origins: string[];
  checkedAt: string;
};

export type StationField = "origin" | "destination";

export type RouteSearchMode = "specific" | "flexible" | "range";

export type RouteOption = {
  id: string;
  type: "direct" | "connection";
  legs: TrainAvailability[];
  waitMinutes: number;
  durationMinutes: number;
  departureDate: string;
  arrivalDate: string;
};

export type ReachableDirection = "outbound" | "inbound";

export type RandomTripStop = {
  city: string;
  arrivalLeg: TrainAvailability;
  stayMinutes: number;
};

export type RandomTripOption = {
  id: string;
  origin: string;
  startAt: string;
  endAt: string;
  requestedCities: number;
  stops: RandomTripStop[];
  returnLeg: TrainAvailability;
  totalTravelMinutes: number;
  totalStayMinutes: number;
  checkedAt: string;
};

type RandomTripOptions = {
  origin: string;
  startAt: string;
  endAt: string;
  cityCount?: number;
  randomCityCount?: boolean;
  excludeTripIds?: string[];
  excludeCities?: string[];
};

export type FlexibleRouteSearchEvent =
  | {
      type: "meta";
      checkedAt: string;
      searchedFrom: string;
      searchedTo: string;
      totalTrains: number;
    }
  | {
      type: "progress";
      date: string;
      legCount: number;
      travelDays?: number;
      message: string;
      foundCount: number;
      totalTrains?: number;
    }
  | {
      type: "route";
      route: RouteOption;
      foundCount: number;
    }
  | {
      type: "done";
      foundCount: number;
    };

type FlexibleRouteSearchOptions = {
  origin: string;
  destination: string;
  startDate?: string | null;
  legCounts?: number[];
  travelDays?: number[];
  limit?: number;
  searchDays?: number;
};

type OpenDataSoftResponse = {
  total_count?: number;
  nhits?: number;
  results?: RawTgvmaxRecord[];
  records?: Array<{ fields?: RawTgvmaxRecord } & RawTgvmaxRecord>;
};

export function isAvailableStatus(status: unknown) {
  if (typeof status !== "string") {
    return false;
  }

  const normalized = normalizeText(status);
  return (
    normalized === "oui" ||
    normalized === "yes" ||
    normalized === "1" ||
    normalized.includes("disponible") ||
    normalized.includes("available")
  );
}

export function normalizeTrainRecord(record: RawTgvmaxRecord): TrainAvailability | null {
  if (!isAvailableStatus(record.od_happy_card)) {
    return null;
  }

  const date = toText(record.date);
  const trainNo = toText(record.train_no);
  const origin = toText(record.origine);
  const destination = toText(record.destination);
  const departureTime = normalizeTime(record.heure_depart);
  const arrivalTime = normalizeTime(record.heure_arrivee);

  if (!date || !trainNo || !origin || !destination || !departureTime || !arrivalTime) {
    return null;
  }

  return {
    id: [date, trainNo, origin, destination, departureTime].join(":"),
    date,
    trainNo,
    entity: toText(record.entity),
    axe: toText(record.axe),
    originCode: toText(record.origine_iata),
    destinationCode: toText(record.destination_iata),
    origin,
    destination,
    departureTime,
    arrivalTime,
    status: toText(record.od_happy_card) || "available"
  };
}

export function normalizeTgvmaxResponse(
  data: OpenDataSoftResponse,
  checkedAt = new Date(),
  filters?: { nightOnly?: boolean }
) {
  const rawRecords = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.records)
      ? data.records.map((record) => record.fields ?? record)
      : [];

  const uniqueRecords = new Map<string, TrainAvailability>();

  for (const record of rawRecords) {
    const normalizedRecord = normalizeTrainRecord(record);
    if (normalizedRecord) {
      uniqueRecords.set(normalizedRecord.id, normalizedRecord);
    }
  }

  const records = Array.from(uniqueRecords.values()).sort(compareTrainAvailability);
  const futureRecords = records.filter(isFutureDeparture);
  const filteredRecords = filters?.nightOnly ? futureRecords.filter(isNightIntercite) : futureRecords;

  return {
    records: filteredRecords,
    totalCount: data.total_count ?? data.nhits ?? filteredRecords.length,
    checkedAt: checkedAt.toISOString()
  };
}

export function filterByOrigin(records: TrainAvailability[], origin: string) {
  const wanted = normalizeText(origin);
  return records.filter((record) => normalizeText(record.origin) === wanted);
}

export function filterByDate(records: TrainAvailability[], date?: string | null) {
  if (!date) {
    return records;
  }

  return records.filter((record) => record.date === date);
}

export function getOriginSuggestions(records: TrainAvailability[], query: string, limit = 12) {
  const normalizedQuery = normalizeText(query);
  const origins = new Set(records.map((record) => record.origin).filter(Boolean));

  return Array.from(origins)
    .filter((origin) => normalizeText(origin).includes(normalizedQuery))
    .sort((a, b) => a.localeCompare(b, "fr"))
    .slice(0, limit);
}

export async function fetchTgvmaxData(options?: { refresh?: boolean }): Promise<TgvmaxPayload> {
  const data = await requestSncfRecords(
    {
      select: SELECT_FIELDS,
      where: availableWhereClause(),
      limit: PAGE_SIZE,
      orderBy: "date asc, heure_depart asc"
    },
    options
  );

  return normalizeTgvmaxResponse(data);
}

export async function fetchOriginSuggestions(
  query: string,
  options?: { refresh?: boolean }
): Promise<OriginSuggestionsPayload> {
  return fetchStationSuggestions("origin", query, options);
}

export async function fetchDestinationSuggestions(
  query: string,
  options?: { refresh?: boolean }
): Promise<OriginSuggestionsPayload> {
  return fetchStationSuggestions("destination", query, options);
}

export async function fetchStationSuggestions(
  field: StationField,
  query: string,
  options?: { refresh?: boolean }
): Promise<OriginSuggestionsPayload> {
  const datasetField = field === "origin" ? "origine" : "destination";
  const where = [availableWhereClause()];
  const cleanedQuery = query.trim();

  if (cleanedQuery) {
    where.push(`search(${datasetField}, ${odsString(cleanedQuery)})`);
  }

  const data = await requestSncfRecords(
    {
      select: datasetField,
      groupBy: datasetField,
      where: where.join(" and "),
      limit: 12,
      orderBy: `${datasetField} asc`
    },
    options
  );

  const stations = (data.results ?? [])
    .map((record) => toText(field === "origin" ? record.origine : record.destination))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "fr"));

  return {
    origins: addAllStationsSuggestions(Array.from(new Set(stations))).slice(0, 12),
    checkedAt: new Date().toISOString()
  };
}

export async function fetchAvailableTrains(
  origin: string,
  date?: string | null,
  filters?: { nightOnly?: boolean },
  options?: { refresh?: boolean }
): Promise<TgvmaxPayload> {
  const where = [availableWhereClause(), originWhereClause(origin)];

  if (date) {
    where.push(`date = date'${date}'`);
  }

  const allResults: RawTgvmaxRecord[] = [];
  let totalCount = 0;
  let offset = 0;

  do {
    const page = await requestSncfRecords(
      {
        select: SELECT_FIELDS,
        where: where.join(" and "),
        limit: PAGE_SIZE,
        offset,
        orderBy: "date asc, heure_depart asc"
      },
      options
    );
    const results = page.results ?? [];

    allResults.push(...results);
    totalCount = page.total_count ?? allResults.length;
    offset += PAGE_SIZE;

    if (results.length < PAGE_SIZE) {
      break;
    }
  } while (offset < totalCount && offset < 2000);

  return normalizeTgvmaxResponse({
    total_count: totalCount,
    results: allResults
  }, undefined, filters);
}

export async function fetchAvailableTrainsToDestination(
  destination: string,
  date?: string | null,
  filters?: { nightOnly?: boolean },
  options?: { refresh?: boolean }
): Promise<TgvmaxPayload> {
  const where = [availableWhereClause(), destinationWhereClause(destination)];

  if (date) {
    where.push(`date = date'${date}'`);
  }

  const allResults: RawTgvmaxRecord[] = [];
  let totalCount = 0;
  let offset = 0;

  do {
    const page = await requestSncfRecords(
      {
        select: SELECT_FIELDS,
        where: where.join(" and "),
        limit: PAGE_SIZE,
        offset,
        orderBy: "date asc, heure_depart asc"
      },
      options
    );
    const results = page.results ?? [];

    allResults.push(...results);
    totalCount = page.total_count ?? allResults.length;
    offset += PAGE_SIZE;

    if (results.length < PAGE_SIZE) {
      break;
    }
  } while (offset < totalCount && offset < 2000);

  return normalizeTgvmaxResponse({
    total_count: totalCount,
    results: allResults
  }, undefined, filters);
}

export async function findRouteOptions({
  origin,
  destination,
  mode,
  date,
  startDate,
  endDate,
  maxLegs = 2
}: {
  origin: string;
  destination: string;
  mode: RouteSearchMode;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  maxLegs?: number;
}) {
  const today = formatDateInput(new Date());
  const fromDate = mode === "specific" ? date || today : startDate || date || today;
  const toDate =
    mode === "specific"
      ? fromDate
      : mode === "range" && endDate
        ? endDate
        : addDays(fromDate, 6);
  const data = await fetchAvailableTrainsBetweenDates(fromDate, toDate);
  const records = data.records;
  const direct = records
    .filter((train) => stationMatches(train.origin, origin) && stationMatches(train.destination, destination))
    .map((train) => routeFromLegs([train]));

  const routes = findRoutesByLegCount(records, origin, destination, mode, maxLegs, direct)
    .sort(compareRoutes)
    .slice(0, mode === "range" ? 80 : 18);

  return {
    routes,
    checkedAt: data.checkedAt,
    searchedFrom: fromDate,
    searchedTo: toDate
  };
}

export async function findReachableRoutes({
  direction,
  station,
  date,
  maxLegs = 3
}: {
  direction: ReachableDirection;
  station: string;
  date?: string | null;
  maxLegs?: number;
}) {
  const today = formatDateInput(new Date());
  const searchDate = date || today;
  const data = await fetchAvailableTrainsBetweenDates(searchDate, searchDate);
  const routes =
    direction === "outbound"
      ? findReachableOutbound(data.records, station, maxLegs)
      : findReachableInbound(data.records, station, maxLegs);

  return {
    routes: routes.sort(compareRoutes).slice(0, 120),
    checkedAt: data.checkedAt,
    searchedFrom: searchDate,
    searchedTo: searchDate
  };
}

export async function findRandomTrip({
  origin,
  startAt,
  endAt,
  cityCount = 3,
  randomCityCount = false,
  excludeTripIds = [],
  excludeCities = []
}: RandomTripOptions) {
  const startMinute = dateTimeInputToMinute(startAt);
  const endMinute = dateTimeInputToMinute(endAt);

  if (endMinute - startMinute < 360) {
    return { trip: null, checkedAt: new Date().toISOString() };
  }

  const startDate = startAt.slice(0, 10);
  const endDate = endAt.slice(0, 10);
  const maxCitiesForWindow = Math.max(1, dateIndex(endDate) - dateIndex(startDate) + 1);
  const data = await fetchAvailableTrainsBetweenDates(startDate, endDate);
  const records = data.records
    .filter((train) => departureMinute(train) >= startMinute && arrivalMinute(train) <= endMinute)
    .sort((a, b) => departureMinute(a) - departureMinute(b));
  const targetCityCounts = randomCityCount
    ? randomCityTargets(maxCitiesForWindow)
    : [Math.max(1, Math.min(maxCitiesForWindow, cityCount))];
  const attempts = randomCityCount ? 80 : 50;
  const excludedTrips = new Set(excludeTripIds);
  const excludedCityKeys = new Set(excludeCities.map(cityKey));
  const candidates: RandomTripOption[] = [];
  const searchProfiles = [
    { avoidAirports: true, minStayMinutes: 360 },
    { avoidAirports: true, minStayMinutes: 240 },
    { avoidAirports: false, minStayMinutes: 180 }
  ];

  for (const activeExcludedCityKeys of excludedCityKeys.size ? [excludedCityKeys, new Set<string>()] : [excludedCityKeys]) {
    for (const profile of searchProfiles) {
      for (const targetCities of targetCityCounts) {
        candidates.push(
          ...findLoopRandomTrips(records, {
            checkedAt: data.checkedAt,
            endAt,
            excludedCityKeys: activeExcludedCityKeys,
            minStayMinutes: profile.minStayMinutes,
            origin,
            startAt,
            targetCities,
            avoidAirports: profile.avoidAirports
          }).filter((trip) => !excludedTrips.has(trip.id))
        );

        for (let attempt = 0; attempt < attempts / 2; attempt += 1) {
          const trip = buildRandomTripAttempt(records, {
            origin,
            startAt,
            endAt,
            targetCities,
            checkedAt: data.checkedAt,
            excludedCityKeys: activeExcludedCityKeys,
            forceReturnDate: undefined,
            looseness: attempt,
            minStayMinutes: profile.minStayMinutes,
            avoidAirports: profile.avoidAirports
          });

          if (trip && !excludedTrips.has(trip.id)) {
            candidates.push(trip);
          }
        }

        if (randomCityCount && targetCities <= 2) {
          candidates.push(
            ...findTwoCityRandomTrips(records, {
              checkedAt: data.checkedAt,
              endAt,
              excludedCityKeys: activeExcludedCityKeys,
              forceReturnDate: undefined,
              minStayMinutes: profile.minStayMinutes,
              origin,
              startAt,
              avoidAirports: profile.avoidAirports
            }).filter((trip) => !excludedTrips.has(trip.id))
          );
        }

        const candidatesForTarget = dedupeRandomTrips(candidates).filter((trip) => trip.stops.length === targetCities);

        if (randomCityCount && candidatesForTarget.length) {
          break;
        }
      }

      if (candidates.length) {
        break;
      }
    }

    if (candidates.length) {
      break;
    }
  }

  return {
    trip: pickRandomTrip(dedupeRandomTrips(candidates), excludedCityKeys),
    checkedAt: data.checkedAt
  };
}

function buildRandomTripAttempt(
  records: TrainAvailability[],
  {
    checkedAt,
    endAt,
    excludedCityKeys,
    forceReturnDate,
    looseness,
    minStayMinutes,
    origin,
    startAt,
    targetCities,
    avoidAirports
  }: {
    checkedAt: string;
    endAt: string;
    excludedCityKeys: Set<string>;
    forceReturnDate?: string;
    looseness: number;
    minStayMinutes: number;
    origin: string;
    startAt: string;
    targetCities: number;
    avoidAirports: boolean;
  }
): RandomTripOption | null {
  const endMinute = dateTimeInputToMinute(endAt);
  let currentPlace = origin;
  let currentMinute = dateTimeInputToMinute(startAt);
  const visitedCities = new Set([cityKey(origin)]);
  const stops: RandomTripStop[] = [];

  for (let stopIndex = 0; stopIndex < targetCities; stopIndex += 1) {
    const remainingStopsAfterThis = targetCities - stopIndex - 1;
    const latestArrival = endMinute - minStayMinutes - remainingStopsAfterThis * (minStayMinutes + 90) - 60;
    const candidates = records
      .filter((train) => {
        const destinationKey = cityKey(train.destination);
        return (
          sameCity(train.origin, currentPlace) &&
          !sameCity(train.destination, origin) &&
          !visitedCities.has(destinationKey) &&
          !excludedCityKeys.has(destinationKey) &&
          (!avoidAirports || !isAirportStation(train.destination)) &&
          departureMinute(train) >= currentMinute &&
          arrivalMinute(train) <= latestArrival
        );
      })
      .sort((a, b) => scoreOutboundRandomLeg(b, currentMinute) - scoreOutboundRandomLeg(a, currentMinute));

    const nextLeg = pickFromTop(candidates, looseness);
    if (!nextLeg) {
      return null;
    }

    const nextCity = cityKey(nextLeg.destination);
    visitedCities.add(nextCity);
    stops.push({
      city: stationCityLabel(nextLeg.destination),
      arrivalLeg: nextLeg,
      stayMinutes: 0
    });
    currentPlace = nextLeg.destination;
    currentMinute = arrivalMinute(nextLeg) + minStayMinutes;
  }

  const returnCandidates = records
    .filter((train) => {
      return (
        sameCity(train.origin, currentPlace) &&
        stationMatches(train.destination, origin) &&
        (!forceReturnDate || minuteToDate(arrivalMinute(train)) === forceReturnDate) &&
        departureMinute(train) >= currentMinute &&
        arrivalMinute(train) <= endMinute
      );
    })
    .sort((a, b) => scoreReturnRandomLeg(b, endMinute) - scoreReturnRandomLeg(a, endMinute));
  const returnLeg = pickFromTop(returnCandidates, looseness);

  if (!returnLeg) {
    return null;
  }

  const legs = [...stops.map((stop) => stop.arrivalLeg), returnLeg];
  const totalTravelMinutes = legs.reduce(
    (sum, leg) => sum + arrivalMinute(leg) - departureMinute(leg),
    0
  );

  const stopsWithStay = stops.map((stop, index) => {
    const nextLeg = legs[index + 1];
    return {
      ...stop,
      stayMinutes: nextLeg ? Math.max(0, departureMinute(nextLeg) - arrivalMinute(stop.arrivalLeg)) : 0
    };
  });
  const totalStayMinutes = stopsWithStay.reduce((sum, stop) => sum + stop.stayMinutes, 0);

  return {
    id: legs.map((leg) => leg.id).join("|"),
    origin,
    startAt,
    endAt,
    requestedCities: targetCities,
    stops: stopsWithStay,
    returnLeg,
    totalTravelMinutes,
    totalStayMinutes,
    checkedAt
  };
}

function findTwoCityRandomTrips(
  records: TrainAvailability[],
  {
    checkedAt,
    endAt,
    excludedCityKeys,
    forceReturnDate,
    minStayMinutes,
    origin,
    startAt,
    avoidAirports
  }: {
    checkedAt: string;
    endAt: string;
    excludedCityKeys: Set<string>;
    forceReturnDate?: string;
    minStayMinutes: number;
    origin: string;
    startAt: string;
    avoidAirports: boolean;
  }
) {
  const startMinute = dateTimeInputToMinute(startAt);
  const endMinute = dateTimeInputToMinute(endAt);
  const firstLegs = records
    .filter((train) => {
      return (
        stationMatches(train.origin, origin) &&
        !sameCity(train.destination, origin) &&
        !excludedCityKeys.has(cityKey(train.destination)) &&
        (!avoidAirports || !isAirportStation(train.destination)) &&
        departureMinute(train) >= startMinute &&
        arrivalMinute(train) <= endMinute
      );
    })
    .sort((a, b) => scoreOutboundRandomLeg(b, startMinute) - scoreOutboundRandomLeg(a, startMinute))
    .slice(0, 90);
  const trips: RandomTripOption[] = [];

  for (const firstLeg of firstLegs) {
    const secondLegs = records
      .filter((train) => {
        return (
          sameCity(train.origin, firstLeg.destination) &&
          !sameCity(train.destination, origin) &&
          !sameCity(train.destination, firstLeg.destination) &&
          !excludedCityKeys.has(cityKey(train.destination)) &&
          (!avoidAirports || !isAirportStation(train.destination)) &&
          departureMinute(train) >= arrivalMinute(firstLeg) + minStayMinutes &&
          arrivalMinute(train) <= endMinute
        );
      })
      .sort((a, b) => scoreOutboundRandomLeg(b, arrivalMinute(firstLeg)) - scoreOutboundRandomLeg(a, arrivalMinute(firstLeg)))
      .slice(0, 30);

    for (const secondLeg of secondLegs) {
      const returnLegs = records
        .filter((train) => {
          return (
            sameCity(train.origin, secondLeg.destination) &&
            stationMatches(train.destination, origin) &&
            (!forceReturnDate || minuteToDate(arrivalMinute(train)) === forceReturnDate) &&
            departureMinute(train) >= arrivalMinute(secondLeg) + minStayMinutes &&
            arrivalMinute(train) <= endMinute
          );
        })
        .sort((a, b) => scoreReturnRandomLeg(b, endMinute) - scoreReturnRandomLeg(a, endMinute))
        .slice(0, 8);

      for (const returnLeg of returnLegs) {
        trips.push(
          randomTripFromLegs({
            checkedAt,
            endAt,
            legs: [firstLeg, secondLeg, returnLeg],
            origin,
            requestedCities: 2,
            startAt
          })
        );
      }
    }
  }

  return trips;
}

function findLoopRandomTrips(
  records: TrainAvailability[],
  {
    checkedAt,
    endAt,
    excludedCityKeys,
    minStayMinutes,
    origin,
    startAt,
    targetCities,
    avoidAirports
  }: {
    checkedAt: string;
    endAt: string;
    excludedCityKeys: Set<string>;
    minStayMinutes: number;
    origin: string;
    startAt: string;
    targetCities: number;
    avoidAirports: boolean;
  }
) {
  const startMinute = dateTimeInputToMinute(startAt);
  const endMinute = dateTimeInputToMinute(endAt);
  const maxBranch = targetCities <= 2 ? 90 : 42;
  type PartialLoop = {
    currentPlace: string;
    legs: TrainAvailability[];
    minute: number;
    score: number;
    visited: Set<string>;
  };
  let partials: PartialLoop[] = [
    {
      currentPlace: origin,
      legs: [],
      minute: startMinute,
      score: 0,
      visited: new Set([cityKey(origin)])
    }
  ];

  for (let depth = 0; depth < targetCities; depth += 1) {
    const expanded: PartialLoop[] = [];

    for (const partial of partials) {
      const options = records
        .filter((train) => {
          const destinationKey = cityKey(train.destination);
          return (
            (partial.legs.length ? sameCity(train.origin, partial.currentPlace) : stationMatches(train.origin, origin)) &&
            !sameCity(train.destination, origin) &&
            !partial.visited.has(destinationKey) &&
            !excludedCityKeys.has(destinationKey) &&
            (!avoidAirports || !isAirportStation(train.destination)) &&
            departureMinute(train) >= partial.minute &&
            arrivalMinute(train) <= endMinute - minStayMinutes
          );
        })
        .sort((a, b) => scoreLoopLeg(b, partial.minute, endMinute, depth) - scoreLoopLeg(a, partial.minute, endMinute, depth))
        .slice(0, maxBranch);

      for (const leg of diversifyLegsByCity(options, Math.max(12, Math.floor(maxBranch / 2)))) {
        const visited = new Set(partial.visited);
        visited.add(cityKey(leg.destination));
        expanded.push({
          currentPlace: leg.destination,
          legs: [...partial.legs, leg],
          minute: arrivalMinute(leg) + minStayMinutes,
          score: partial.score + scoreLoopLeg(leg, partial.minute, endMinute, depth),
          visited
        });
      }
    }

    partials = expanded
      .sort((a, b) => b.score - a.score + Math.random() * 80 - 40)
      .slice(0, targetCities <= 2 ? 180 : 90);

    if (!partials.length) {
      return [];
    }
  }

  const trips: RandomTripOption[] = [];

  for (const partial of partials) {
    const returnOptions = records
      .filter((train) => {
        return (
          sameCity(train.origin, partial.currentPlace) &&
          stationMatches(train.destination, origin) &&
          departureMinute(train) >= partial.minute &&
          arrivalMinute(train) <= endMinute
        );
      })
      .sort((a, b) => scoreReturnRandomLeg(b, endMinute) - scoreReturnRandomLeg(a, endMinute))
      .slice(0, 12);

    for (const returnLeg of returnOptions) {
      trips.push(
        randomTripFromLegs({
          checkedAt,
          endAt,
          legs: [...partial.legs, returnLeg],
          origin,
          requestedCities: targetCities,
          startAt
        })
      );
    }
  }

  return trips;
}

function randomTripFromLegs({
  checkedAt,
  endAt,
  legs,
  origin,
  requestedCities,
  startAt
}: {
  checkedAt: string;
  endAt: string;
  legs: TrainAvailability[];
  origin: string;
  requestedCities: number;
  startAt: string;
}): RandomTripOption {
  const stopLegs = legs.slice(0, -1);
  const returnLeg = legs[legs.length - 1];
  const totalTravelMinutes = legs.reduce(
    (sum, leg) => sum + arrivalMinute(leg) - departureMinute(leg),
    0
  );
  const stops = stopLegs.map((leg, index) => {
    const nextLeg = legs[index + 1];
    return {
      city: stationCityLabel(leg.destination),
      arrivalLeg: leg,
      stayMinutes: nextLeg ? Math.max(0, departureMinute(nextLeg) - arrivalMinute(leg)) : 0
    };
  });

  return {
    id: legs.map((leg) => leg.id).join("|"),
    origin,
    startAt,
    endAt,
    requestedCities,
    stops,
    returnLeg,
    totalTravelMinutes,
    totalStayMinutes: stops.reduce((sum, stop) => sum + stop.stayMinutes, 0),
    checkedAt
  };
}

export async function* streamFlexibleRouteSearch({
  origin,
  destination,
  startDate,
  legCounts,
  travelDays,
  limit
}: FlexibleRouteSearchOptions): AsyncGenerator<FlexibleRouteSearchEvent> {
  const today = formatDateInput(new Date());
  const fromDate = startDate || today;
  const toDate = addDays(fromDate, 29);
  const selectedTravelDays = normalizeNumberSelection(travelDays, [1, 2, 3], [1, 2, 3]);
  const maxTravelDays = Math.max(...selectedTravelDays);
  let totalTrains = 0;

  yield {
    type: "meta",
    checkedAt: new Date().toISOString(),
    searchedFrom: fromDate,
    searchedTo: toDate,
    totalTrains
  };

  for (const candidateDate of dateRange(fromDate, 30)) {
    yield {
      type: "progress",
      date: candidateDate,
      legCount: 0,
      message: `Loading trains for departures on ${candidateDate}.`,
      foundCount: 0,
      totalTrains
    };

    const data = await fetchAvailableTrainsBetweenDates(candidateDate, addDays(candidateDate, maxTravelDays - 1));
    totalTrains += data.records.length;

    yield {
      type: "progress",
      date: candidateDate,
      legCount: 0,
      message: `Loaded ${data.records.length} trains for ${candidateDate}. Checking possible connections.`,
      foundCount: 0,
      totalTrains
    };

    for (const event of findFlexibleRoutesInRecords(data.records, {
      origin,
      destination,
      startDate: candidateDate,
      legCounts,
      travelDays,
      limit,
      searchDays: 1
    })) {
      if (event.type === "done") {
        if (event.foundCount > 0) {
          yield event;
          return;
        }
        continue;
      }

      yield event;
    }
  }

  yield { type: "done", foundCount: 0 };
}

export function* findFlexibleRoutesInRecords(
  records: TrainAvailability[],
  {
    origin,
    destination,
    startDate,
    legCounts,
    travelDays,
    limit = 10,
    searchDays = 30
  }: FlexibleRouteSearchOptions
): Generator<FlexibleRouteSearchEvent> {
  const fromDate = startDate || formatDateInput(new Date());
  const selectedLegCounts = normalizeNumberSelection(legCounts, [1, 2, 3, 4], [1, 2, 3]);
  const selectedTravelDays = normalizeNumberSelection(travelDays, [1, 2, 3], [1, 2, 3]);
  const firstSearchMinute = dateIndex(fromDate) * 1440;
  const sortedRecords = records
    .filter((train) => departureMinute(train) >= firstSearchMinute)
    .sort((a, b) => departureMinute(a) - departureMinute(b));
  const byOriginCity = groupByOriginCity(sortedRecords);
  const seenRoutes = new Set<string>();
  let foundCount = 0;

  for (const date of dateRange(fromDate, searchDays)) {
    const dateRoutes: RouteOption[] = [];
    const firstLegs = sortedRecords.filter(
      (train) => train.date === date && stationMatches(train.origin, origin)
    );

    for (const travelDayCount of selectedTravelDays) {
      for (const legCount of selectedLegCounts) {
        yield {
          type: "progress",
          date,
          legCount,
          travelDays: travelDayCount,
          message: `Verificando viagens de ${travelDayCount} dia${travelDayCount > 1 ? "s" : ""}, ${legCount} trem${legCount > 1 ? "s" : ""}, no dia ${date}.`,
          foundCount
        };

        for (const firstLeg of firstLegs) {
          walkRoute(
            [firstLeg],
            new Set([cityKey(firstLeg.origin)]),
            legCount,
            travelDayCount,
            dateRoutes
          );
        }
      }
    }

    if (dateRoutes.length) {
      const bestRoutes = dateRoutes
        .sort(compareFlexibleRoutes)
        .slice(0, limit);

      yield {
        type: "progress",
        date,
        legCount: 0,
        message: `Encontrei rotas saindo em ${date}. Mostrando as ${bestRoutes.length} melhores e parando a busca.`,
        foundCount: bestRoutes.length
      };

      for (const route of bestRoutes) {
        foundCount += 1;
        yield { type: "route", route, foundCount };
      }

      yield { type: "done", foundCount };
      return;
    }
  }

  yield { type: "done", foundCount };

  function walkRoute(
    legs: TrainAvailability[],
    visitedCities: Set<string>,
    targetLegCount: number,
    targetTravelDays: number,
    routesForDate: RouteOption[]
  ) {
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];
    const travelMinutes = arrivalMinute(lastLeg) - departureMinute(firstLeg);

    if (travelMinutes > targetTravelDays * 1440) {
      return;
    }

    if (stationMatches(lastLeg.destination, destination)) {
      const route = routeFromLegs(legs);
      const daySpan = routeTravelDaySpan(route);
      if (
        legs.length === targetLegCount &&
        daySpan === targetTravelDays &&
        !seenRoutes.has(route.id)
      ) {
        seenRoutes.add(route.id);
        routesForDate.push(route);
      }
      return;
    }

    if (legs.length >= targetLegCount) {
      return;
    }

    const nextLegs = byOriginCity.get(cityKey(lastLeg.destination)) ?? [];
    for (const nextLeg of nextLegs) {
      const waitMinutes = departureMinute(nextLeg) - arrivalMinute(lastLeg);
      if (waitMinutes < 15) {
        continue;
      }

      if (departureMinute(nextLeg) - departureMinute(firstLeg) > targetTravelDays * 1440) {
        break;
      }

      const nextCity = cityKey(nextLeg.destination);
      if (visitedCities.has(nextCity) && !stationMatches(nextLeg.destination, destination)) {
        continue;
      }

      const nextVisited = new Set(visitedCities);
      nextVisited.add(nextCity);
      walkRoute([...legs, nextLeg], nextVisited, targetLegCount, targetTravelDays, routesForDate);
    }
  }
}

export function isNightIntercite(train: TrainAvailability) {
  const entity = normalizeText(`${train.entity} ${train.axe}`);
  return entity.includes("intercite") && arrivesNextDay(train);
}

export function stationMatches(station: string, query: string) {
  const city = allStationsCity(query);
  if (city) {
    return normalizeText(stationCityLabel(station)) === normalizeText(city);
  }

  const normalizedStation = normalizeText(station);
  const normalizedQuery = normalizeText(query);
  return normalizedStation === normalizedQuery || normalizedStation.includes(normalizedQuery);
}

async function fetchAvailableTrainsBetweenDates(
  startDate: string,
  endDate: string
): Promise<TgvmaxPayload> {
  const where = [
    availableWhereClause(),
    `date >= date'${startDate}'`,
    `date <= date'${endDate}'`
  ];
  const allResults: RawTgvmaxRecord[] = [];
  let totalCount = 0;
  let offset = 0;

  do {
    const page = await requestSncfRecords({
      select: SELECT_FIELDS,
      where: where.join(" and "),
      limit: PAGE_SIZE,
      offset,
      orderBy: "date asc, heure_depart asc"
    });
    const results = page.results ?? [];

    allResults.push(...results);
    totalCount = page.total_count ?? allResults.length;
    offset += PAGE_SIZE;

    if (results.length < PAGE_SIZE) {
      break;
    }
  } while (offset < totalCount && offset < 5000);

  return normalizeTgvmaxResponse({
    total_count: totalCount,
    results: allResults
  });
}

function findRoutesByLegCount(
  records: TrainAvailability[],
  origin: string,
  destination: string,
  mode: RouteSearchMode,
  maxLegs: number,
  direct: RouteOption[]
) {
  if (direct.length || mode === "range" || maxLegs <= 1) {
    return direct;
  }

  for (let legCount = 2; legCount <= Math.min(maxLegs, 4); legCount += 1) {
    const routes = findConnectionRoutes(records, origin, destination, mode, legCount);
    if (routes.length) {
      return routes;
    }
  }

  return [];
}

function findConnectionRoutes(
  records: TrainAvailability[],
  origin: string,
  destination: string,
  mode: RouteSearchMode,
  legCount: number
) {
  const sortedRecords = records.slice().sort((a, b) => departureMinute(a) - departureMinute(b));
  const routes: RouteOption[] = [];
  const firstLegs = sortedRecords.filter((train) => stationMatches(train.origin, origin));

  for (const firstLeg of firstLegs) {
    walkRoute([firstLeg], new Set([stationCityLabel(firstLeg.origin)]));
    if (routes.length >= 40) {
      break;
    }
  }

  return dedupeRoutes(routes).slice(0, 24);

  function walkRoute(legs: TrainAvailability[], visitedCities: Set<string>) {
    const lastLeg = legs[legs.length - 1];
    const lastCity = stationCityLabel(lastLeg.destination);

    if (legs.length === legCount) {
      if (stationMatches(lastLeg.destination, destination)) {
        routes.push(routeFromLegs(legs));
      }
      return;
    }

    if (stationMatches(lastLeg.destination, destination)) {
      return;
    }

    const nextLegs = sortedRecords.filter((candidate) => {
      if (!sameCity(lastLeg.destination, candidate.origin)) {
        return false;
      }

      if (mode === "specific" && candidate.date !== legs[0].date) {
        return false;
      }

      if (departureMinute(candidate) - arrivalMinute(lastLeg) < 15) {
        return false;
      }

      const nextCity = stationCityLabel(candidate.destination);
      return !visitedCities.has(nextCity) || stationMatches(candidate.destination, destination);
    });

    for (const nextLeg of nextLegs.slice(0, 60)) {
      const nextCity = stationCityLabel(nextLeg.destination);
      const nextVisited = new Set(visitedCities);
      nextVisited.add(lastCity);
      nextVisited.add(nextCity);
      walkRoute([...legs, nextLeg], nextVisited);
      if (routes.length >= 40) {
        return;
      }
    }
  }
}

function findReachableOutbound(records: TrainAvailability[], origin: string, maxLegs: number) {
  const sortedRecords = records.slice().sort((a, b) => departureMinute(a) - departureMinute(b));
  const routes: RouteOption[] = [];
  const firstLegs = sortedRecords.filter((train) => stationMatches(train.origin, origin));

  for (const firstLeg of firstLegs) {
    walk([firstLeg], new Set([stationCityLabel(firstLeg.origin)]));
    if (routes.length >= 180) {
      break;
    }
  }

  return dedupeRoutes(routes);

  function walk(legs: TrainAvailability[], visitedCities: Set<string>) {
    routes.push(routeFromLegs(legs));

    if (legs.length >= Math.min(maxLegs, 3)) {
      return;
    }

    const lastLeg = legs[legs.length - 1];
    const nextLegs = sortedRecords.filter((candidate) => {
      if (!sameCity(lastLeg.destination, candidate.origin)) {
        return false;
      }

      if (departureMinute(candidate) - arrivalMinute(lastLeg) < 15) {
        return false;
      }

      const nextCity = stationCityLabel(candidate.destination);
      return !visitedCities.has(nextCity);
    });

    for (const nextLeg of nextLegs.slice(0, 40)) {
      const nextVisited = new Set(visitedCities);
      nextVisited.add(stationCityLabel(nextLeg.destination));
      walk([...legs, nextLeg], nextVisited);
    }
  }
}

function findReachableInbound(records: TrainAvailability[], destination: string, maxLegs: number) {
  const sortedRecords = records.slice().sort((a, b) => departureMinute(a) - departureMinute(b));
  const routes: RouteOption[] = [];

  for (const firstLeg of sortedRecords) {
    walk([firstLeg], new Set([stationCityLabel(firstLeg.origin)]));
    if (routes.length >= 180) {
      break;
    }
  }

  return dedupeRoutes(
    routes.filter((route) => stationMatches(route.legs[route.legs.length - 1].destination, destination))
  );

  function walk(legs: TrainAvailability[], visitedCities: Set<string>) {
    const lastLeg = legs[legs.length - 1];

    if (stationMatches(lastLeg.destination, destination)) {
      routes.push(routeFromLegs(legs));
      return;
    }

    if (legs.length >= Math.min(maxLegs, 3)) {
      return;
    }

    const nextLegs = sortedRecords.filter((candidate) => {
      if (!sameCity(lastLeg.destination, candidate.origin)) {
        return false;
      }

      if (departureMinute(candidate) - arrivalMinute(lastLeg) < 15) {
        return false;
      }

      const nextCity = stationCityLabel(candidate.destination);
      return !visitedCities.has(nextCity) || stationMatches(candidate.destination, destination);
    });

    for (const nextLeg of nextLegs.slice(0, 40)) {
      const nextVisited = new Set(visitedCities);
      nextVisited.add(stationCityLabel(nextLeg.destination));
      walk([...legs, nextLeg], nextVisited);
    }
  }
}

function routeFromLegs(legs: TrainAvailability[]): RouteOption {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const waitMinutes =
    legs.length === 1
      ? 0
      : legs.slice(1).reduce((sum, leg, index) => sum + departureMinute(leg) - arrivalMinute(legs[index]), 0);
  const departure = departureMinute(first);
  const arrival = arrivalMinute(last);

  return {
    id: legs.map((leg) => leg.id).join("|"),
    type: legs.length === 1 ? "direct" : "connection",
    legs,
    waitMinutes,
    durationMinutes: arrival - departure,
    departureDate: first.date,
    arrivalDate: minuteToDate(arrival)
  };
}

function dedupeRoutes(routes: RouteOption[]) {
  return Array.from(new Map(routes.map((route) => [route.id, route])).values()).sort(compareRoutes);
}

function compareRoutes(a: RouteOption, b: RouteOption) {
  if (a.legs.length !== b.legs.length) {
    return a.legs.length - b.legs.length;
  }

  if (a.legs.length === 1) {
    return departureMinute(a.legs[0]) - departureMinute(b.legs[0]);
  }

  return (
    a.durationMinutes - b.durationMinutes ||
    departureMinute(a.legs[0]) - departureMinute(b.legs[0])
  );
}

function compareFlexibleRoutes(a: RouteOption, b: RouteOption) {
  return (
    routeArrivalMinute(a) - routeArrivalMinute(b) ||
    a.durationMinutes - b.durationMinutes ||
    a.legs.length - b.legs.length ||
    departureMinute(a.legs[0]) - departureMinute(b.legs[0])
  );
}

function routeArrivalMinute(route: RouteOption) {
  return arrivalMinute(route.legs[route.legs.length - 1]);
}

function scoreOutboundRandomLeg(train: TrainAvailability, currentMinute: number) {
  const depart = departureMinute(train);
  const wait = Math.max(0, depart - currentMinute);
  const localDepart = timeToMinutes(train.departureTime);
  const localArrival = timeToMinutes(train.arrivalTime);
  const morningBonus = 720 - Math.abs(localDepart - 540);
  const usefulDayBonus = 780 - Math.abs(localArrival - 660);

  return morningBonus + usefulDayBonus - wait / 4 + Math.random() * 120;
}

function scoreReturnRandomLeg(train: TrainAvailability, endMinute: number) {
  const arrive = arrivalMinute(train);
  const localDepart = timeToMinutes(train.departureTime);
  const eveningBonus = 720 - Math.abs(localDepart - 1080);

  return eveningBonus - Math.abs(endMinute - arrive) / 3 + Math.random() * 80;
}

function scoreLoopLeg(train: TrainAvailability, currentMinute: number, endMinute: number, depth: number) {
  const depart = departureMinute(train);
  const arrive = arrivalMinute(train);
  const localDepart = timeToMinutes(train.departureTime);
  const wait = Math.max(0, depart - currentMinute);
  const travel = Math.max(1, arrive - depart);
  const dayUseBonus = depth === 0 ? 620 - Math.abs(localDepart - 570) : 520 - Math.abs(localDepart - 660);
  const windowUseBonus = Math.min(900, Math.max(0, endMinute - arrive) / 3);

  return dayUseBonus + windowUseBonus - wait / 5 - travel / 3 + Math.random() * 160;
}

function diversifyLegsByCity(legs: TrainAvailability[], limit: number) {
  const firstByCity = new Map<string, TrainAvailability>();
  const leftovers: TrainAvailability[] = [];

  for (const leg of legs) {
    const key = cityKey(leg.destination);
    if (!firstByCity.has(key)) {
      firstByCity.set(key, leg);
    } else {
      leftovers.push(leg);
    }
  }

  return [...firstByCity.values(), ...leftovers].slice(0, limit);
}

function pickFromTop<T>(items: T[], looseness: number) {
  if (!items.length) {
    return null;
  }

  const topCount = Math.min(items.length, Math.max(2, 4 + (looseness % 5)));
  return items[Math.floor(Math.random() * topCount)];
}

function scoreRandomTrip(trip: RandomTripOption) {
  return (
    trip.stops.length * 2000 +
    trip.totalStayMinutes * 3 -
    trip.totalTravelMinutes +
    Math.random() * 100
  );
}

function dedupeRandomTrips(trips: RandomTripOption[]) {
  return Array.from(new Map(trips.map((trip) => [trip.id, trip])).values());
}

function pickRandomTrip(trips: RandomTripOption[], excludedCityKeys: Set<string>) {
  if (!trips.length) {
    return null;
  }

  const rankedTrips = trips
    .map((trip) => ({
      score: scoreRandomTrip(trip) - cityRepeatPenalty(trip, excludedCityKeys) + Math.random() * 600,
      trip
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.trip);
  const bySignature = new Map<string, RandomTripOption>();

  for (const trip of rankedTrips) {
    const signature = tripCitySignature(trip);
    if (!bySignature.has(signature)) {
      bySignature.set(signature, trip);
    }
  }

  const diverseTrips = [...bySignature.values()].slice(0, Math.min(bySignature.size, 14));
  const topTrips = diverseTrips.length ? diverseTrips : rankedTrips.slice(0, Math.min(rankedTrips.length, 8));
  return weightedRandomTrip(topTrips, excludedCityKeys);
}

function weightedRandomTrip(trips: RandomTripOption[], excludedCityKeys: Set<string>) {
  const weights = trips.map((trip, index) => {
    const score = scoreRandomTrip(trip) - cityRepeatPenalty(trip, excludedCityKeys) - index * 120;
    return Math.max(1, score);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;

  for (let index = 0; index < trips.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) {
      return trips[index];
    }
  }

  return trips[trips.length - 1];
}

function cityRepeatPenalty(trip: RandomTripOption, excludedCityKeys: Set<string>) {
  return trip.stops.reduce((penalty, stop) => {
    return penalty + (excludedCityKeys.has(cityKey(stop.city || stop.arrivalLeg.destination)) ? 3500 : 0);
  }, 0);
}

function tripCitySignature(trip: RandomTripOption) {
  return trip.stops
    .map((stop) => cityKey(stop.city || stop.arrivalLeg.destination))
    .sort()
    .join("|");
}

function isAirportStation(station: string) {
  const normalized = normalizeText(station);
  return (
    normalized.includes("aeroport") ||
    normalized.includes("airport") ||
    normalized.includes("roissy") ||
    normalized.includes("orly") ||
    normalized.includes("cdg")
  );
}

function randomCityTargets(maxCitiesForWindow: number) {
  const maxCities = Math.min(5, Math.max(1, maxCitiesForWindow));
  const minCities = maxCitiesForWindow >= 2 ? 2 : 1;
  const targets: number[] = [];

  for (let count = maxCities; count >= minCities; count -= 1) {
    targets.push(count);
  }

  return targets;
}

function sameCity(a: string, b: string) {
  return cityKey(a) === cityKey(b);
}

function arrivesNextDay(train: TrainAvailability) {
  return timeToMinutes(train.arrivalTime) <= timeToMinutes(train.departureTime);
}

function departureMinute(train: TrainAvailability) {
  return dateIndex(train.date) * 1440 + timeToMinutes(train.departureTime);
}

function isFutureDeparture(train: TrainAvailability) {
  return departureMinute(train) > currentFranceMinute();
}

function arrivalMinute(train: TrainAvailability) {
  return (
    dateIndex(train.date) * 1440 +
    timeToMinutes(train.arrivalTime) +
    (arrivesNextDay(train) ? 1440 : 0)
  );
}

function dateIndex(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function dateTimeInputToMinute(value: string) {
  const [date = formatDateInput(new Date()), time = "00:00"] = value.split("T");
  return dateIndex(date) * 1440 + timeToMinutes(time);
}

function currentFranceMinute() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${value.year}-${value.month}-${value.day}`;

  return dateIndex(date) * 1440 + Number(value.hour) * 60 + Number(value.minute);
}

function minuteToDate(minute: number) {
  return new Date(Math.floor(minute / 1440) * 86400000).toISOString().slice(0, 10);
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

function dateRange(startDate: string, days: number) {
  return Array.from({ length: days }, (_, index) => addDays(startDate, index));
}

function groupByOriginCity(records: TrainAvailability[]) {
  const groups = new Map<string, TrainAvailability[]>();

  for (const record of records) {
    const key = cityKey(record.origin);
    const group = groups.get(key);
    if (group) {
      group.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  return groups;
}

function cityKey(value: string) {
  return normalizeText(stationCityLabel(value));
}

function normalizeNumberSelection(
  values: number[] | undefined,
  allowed: number[],
  fallback: number[]
) {
  const selected = Array.from(new Set(values ?? []))
    .filter((value) => allowed.includes(value))
    .sort((a, b) => a - b);

  return selected.length ? selected : fallback;
}

function routeTravelDaySpan(route: RouteOption) {
  return Math.max(1, dateIndex(route.arrivalDate) - dateIndex(route.departureDate) + 1);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function requestSncfRecords(
  query: {
    select: string;
    where?: string;
    groupBy?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
  },
  options?: { refresh?: boolean }
): Promise<OpenDataSoftResponse> {
  const url = new URL(SNCF_API_URL);
  url.searchParams.set("select", query.select);
  url.searchParams.set("limit", String(query.limit ?? PAGE_SIZE));

  if (query.where) {
    url.searchParams.set("where", query.where);
  }

  if (query.groupBy) {
    url.searchParams.set("group_by", query.groupBy);
  }

  if (query.offset) {
    url.searchParams.set("offset", String(query.offset));
  }

  if (query.orderBy) {
    url.searchParams.set("order_by", query.orderBy);
  }

  const response = await fetch(url, {
    next: options?.refresh
      ? undefined
      : {
          revalidate: 60 * 60 * 6,
          tags: [SNCF_CACHE_TAG]
        },
    cache: options?.refresh ? "no-store" : undefined
  });

  if (!response.ok) {
    throw new Error(`SNCF Open Data returned ${response.status}`);
  }

  return (await response.json()) as OpenDataSoftResponse;
}

function availableWhereClause() {
  return 'od_happy_card = "OUI"';
}

function originWhereClause(origin: string) {
  const city = allStationsCity(origin);
  if (city) {
    return `search(origine, ${odsString(city)})`;
  }

  return `(origine = ${odsString(origin)} or search(origine, ${odsString(origin)}))`;
}

function destinationWhereClause(destination: string) {
  const city = allStationsCity(destination);
  if (city) {
    return `search(destination, ${odsString(city)})`;
  }

  return `(destination = ${odsString(destination)} or search(destination, ${odsString(destination)}))`;
}

function addAllStationsSuggestions(stations: string[]) {
  const byCity = new Map<string, { label: string; count: number }>();

  for (const station of stations) {
    const city = stationCityLabel(station);
    if (!city) {
      continue;
    }

    const current = byCity.get(city) ?? { label: `${city} (all stations)`, count: 0 };
    current.count += 1;
    byCity.set(city, current);
  }

  const citySuggestions = Array.from(byCity.values())
    .filter((item) => item.count > 1)
    .map((item) => item.label);

  return Array.from(new Set([...citySuggestions, ...stations])).sort((a, b) =>
    a.localeCompare(b, "fr")
  );
}

function allStationsCity(value: string) {
  const match = value.trim().match(/^(.+?)\s+\(all stations\)$/i);
  return match?.[1]?.trim() ?? "";
}

function stationCityLabel(value: string) {
  const cleaned = toText(value)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const upper = cleaned
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();

  if (upper.startsWith("LA ROCHELLE")) {
    return "LA ROCHELLE";
  }

  if (upper.startsWith("LE MANS")) {
    return "LE MANS";
  }

  if (upper.startsWith("SAINT ETIENNE") || upper.startsWith("ST ETIENNE")) {
    return "SAINT ETIENNE";
  }

  return cleaned.split(" ")[0] ?? cleaned;
}

function odsString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function compareTrainAvailability(a: TrainAvailability, b: TrainAvailability) {
  return (
    a.date.localeCompare(b.date) ||
    a.departureTime.localeCompare(b.departureTime) ||
    a.destination.localeCompare(b.destination, "fr") ||
    a.trainNo.localeCompare(b.trainNo)
  );
}

function normalizeTime(value: unknown) {
  const text = toText(value);
  if (!text) {
    return "";
  }

  return text.slice(0, 5);
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeText(value: unknown) {
  return toText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
