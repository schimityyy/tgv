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

function sameCity(a: string, b: string) {
  return normalizeText(stationCityLabel(a)) === normalizeText(stationCityLabel(b));
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
