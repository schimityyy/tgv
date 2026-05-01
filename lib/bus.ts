import { inflateRawSync } from "node:zlib";

export const BUS_CACHE_TAG = "intercity-bus-gtfs";

export type BusProvider = "flixbus" | "blablacar";

export type BusLeg = {
  id: string;
  provider: BusProvider;
  providerLabel: string;
  routeId: string;
  routeName: string;
  tripId: string;
  date: string;
  departureDate: string;
  arrivalDate: string;
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  originLat: number | null;
  originLon: number | null;
  destinationLat: number | null;
  destinationLon: number | null;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
};

export type BusRouteOption = {
  id: string;
  type: "direct" | "connection";
  legs: BusLeg[];
  waitMinutes: number;
  durationMinutes: number;
  departureDate: string;
  arrivalDate: string;
  providers: BusProvider[];
};

export type BusSearchPayload = {
  legs: BusLeg[];
  totalCount: number;
  checkedAt: string;
};

export type BusRoutesPayload = {
  routes: BusRouteOption[];
  checkedAt: string;
  searchedFrom: string;
  searchedTo: string;
};

export type BusSuggestionsPayload = {
  origins: string[];
  checkedAt: string;
};

type BusFeedConfig = {
  label: string;
  url: string;
};

type GtfsStop = {
  id: string;
  name: string;
  city: string;
  lat: number | null;
  lon: number | null;
};

type GtfsRoute = {
  id: string;
  name: string;
};

type GtfsTrip = {
  id: string;
  routeId: string;
  serviceId: string;
  headsign: string;
};

type GtfsStopTime = {
  tripId: string;
  stopId: string;
  sequence: number;
  arrivalMinutes: number;
  departureMinutes: number;
};

type CalendarRule = {
  serviceId: string;
  startDate: string;
  endDate: string;
  weekdays: boolean[];
};

type ParsedBusFeed = {
  provider: BusProvider;
  providerLabel: string;
  checkedAt: string;
  stops: Map<string, GtfsStop>;
  routes: Map<string, GtfsRoute>;
  trips: Map<string, GtfsTrip>;
  stopTimesByTrip: Map<string, GtfsStopTime[]>;
  serviceRules: CalendarRule[];
  exceptionsByDate: Map<string, Map<string, number>>;
  legsByDate: Map<string, BusLeg[]>;
};

type ProviderCache = {
  data?: ParsedBusFeed;
  expiresAt: number;
  promise?: Promise<ParsedBusFeed>;
};

type ZipEntry = {
  compressedSize: number;
  localHeaderOffset: number;
  method: number;
  name: string;
  uncompressedSize: number;
};

const BUS_FEEDS: Record<BusProvider, BusFeedConfig> = {
  flixbus: {
    label: "FlixBus",
    url: "http://gtfs.gis.flix.tech/gtfs_generic_eu.zip"
  },
  blablacar: {
    label: "BlaBlaCar Bus",
    url: "https://www.data.gouv.fr/api/1/datasets/r/fd54f81f-4389-4e73-be75-491133d011c3"
  }
};

const DEFAULT_PROVIDERS: BusProvider[] = ["flixbus", "blablacar"];
const REQUIRED_GTFS_FILES = [
  "stops.txt",
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt"
];
const PAGE_LIMIT = 160;
const MIN_BUS_TRANSFER_MINUTES = 25;
const MAX_CONNECTION_WAIT_MINUTES = 8 * 60;
const IN_MEMORY_CACHE_MS = 1000 * 60 * 60 * 6;
const providerCaches = new Map<BusProvider, ProviderCache>();

export function normalizeBusProviders(value?: string | BusProvider[] | null): BusProvider[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : DEFAULT_PROVIDERS;
  const selected = rawValues
    .map((item) => String(item).trim().toLowerCase())
    .filter((item): item is BusProvider => item === "flixbus" || item === "blablacar");

  return selected.length ? Array.from(new Set(selected)) : DEFAULT_PROVIDERS;
}

export async function fetchBusStationSuggestions(
  field: "origin" | "destination",
  query: string,
  providers?: BusProvider[],
  options?: { refresh?: boolean }
): Promise<BusSuggestionsPayload> {
  const feeds = await loadBusFeeds(providers, options);
  const normalizedQuery = normalizeText(query);
  const stationNames = new Set<string>();

  for (const feed of feeds) {
    for (const stop of feed.stops.values()) {
      if (
        !normalizedQuery ||
        looseTextMatches(stop.name, query) ||
        looseTextMatches(stop.city, query)
      ) {
        stationNames.add(stop.name);
      }
    }
  }

  const suggestions = addAllStationsSuggestions(Array.from(stationNames))
    .sort((a, b) => a.localeCompare(b, "fr"))
    .slice(0, 14);

  return {
    origins: suggestions,
    checkedAt: checkedAtForFeeds(feeds)
  };
}

export async function fetchBusLegs({
  date,
  direction,
  providers,
  station
}: {
  date?: string | null;
  direction: "outbound" | "inbound";
  providers?: BusProvider[];
  station: string;
}): Promise<BusSearchPayload> {
  const searchDate = date || formatDateInput(new Date());
  const legs = await getBusLegsForDate(searchDate, providers);
  const matchingLegs = legs
    .filter((leg) =>
      direction === "inbound"
        ? busStationMatches(leg.destination, station)
        : busStationMatches(leg.origin, station)
    )
    .sort(compareBusLegs)
    .slice(0, PAGE_LIMIT);

  return {
    legs: matchingLegs,
    totalCount: matchingLegs.length,
    checkedAt: new Date().toISOString()
  };
}

export async function findBusRouteOptions({
  date,
  destination,
  maxLegs = 2,
  origin,
  providers
}: {
  date?: string | null;
  destination: string;
  maxLegs?: number;
  origin: string;
  providers?: BusProvider[];
}): Promise<BusRoutesPayload> {
  const searchDate = date || formatDateInput(new Date());
  const legs = await getBusLegsForDate(searchDate, providers);
  const directRoutes = legs
    .filter((leg) => busStationMatches(leg.origin, origin) && busStationMatches(leg.destination, destination))
    .map((leg) => busRouteFromLegs([leg]));
  const routes =
    maxLegs > 1
      ? [...directRoutes, ...findBusConnectionRoutes(legs, origin, destination)]
      : directRoutes;
  const sortedRoutes = dedupeBusRoutes(routes).sort(compareBusRoutes).slice(0, 48);

  return {
    routes: sortedRoutes,
    checkedAt: new Date().toISOString(),
    searchedFrom: searchDate,
    searchedTo: searchDate
  };
}

export async function refreshBusData(providers?: BusProvider[]) {
  const selected = normalizeBusProviders(providers);
  selected.forEach((provider) => providerCaches.delete(provider));
  const feeds = await loadBusFeeds(selected, { refresh: true });

  return {
    ok: true,
    checkedAt: checkedAtForFeeds(feeds),
    providers: feeds.map((feed) => ({
      provider: feed.provider,
      stops: feed.stops.size,
      trips: feed.trips.size
    }))
  };
}

export async function getBusLegsForDate(date: string, providers?: BusProvider[]) {
  const feeds = await loadBusFeeds(providers);
  const legs = feeds.flatMap((feed) => buildLegsForFeedDate(feed, date));
  return legs.sort(compareBusLegs);
}

export function busStationMatches(station: string, query: string) {
  const city = allStationsCity(query);
  if (city) {
    return placeCityKey(station) === placeCityKey(city);
  }

  return (
    looseTextMatches(station, query) ||
    looseTextMatches(placeCityLabel(station), query) ||
    placeCityKey(station) === placeCityKey(query)
  );
}

export function busDepartureMinute(leg: BusLeg) {
  return dateIndex(leg.departureDate) * 1440 + timeToMinutes(leg.departureTime);
}

export function busArrivalMinute(leg: BusLeg) {
  return dateIndex(leg.arrivalDate) * 1440 + timeToMinutes(leg.arrivalTime);
}

export function placeCityKey(value: string) {
  return normalizeText(placeCityLabel(value));
}

export function placeCityLabel(value: string) {
  const cleaned = toText(value)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const upper = stripAccents(cleaned).toUpperCase();

  if (upper.startsWith("LA ROCHELLE")) {
    return "LA ROCHELLE";
  }

  if (upper.startsWith("LE MANS")) {
    return "LE MANS";
  }

  if (upper.startsWith("SAINT ETIENNE") || upper.startsWith("ST ETIENNE")) {
    return "SAINT ETIENNE";
  }

  const words = upper.replace(/^ST\s+/, "SAINT ").split(" ").filter(Boolean);
  if (words[0] === "SAINT" && words[1]) {
    let end = 2;
    const linkWords = new Set(["DE", "DES", "DU", "EN", "SUR", "SOUS", "LE", "LA", "LES"]);

    while (end < words.length && linkWords.has(words[end])) {
      end = Math.min(words.length, end + 2);
    }

    return words.slice(0, end).join(" ");
  }

  if (["LE", "LA", "LES"].includes(words[0] ?? "") && words[1]) {
    return words.slice(0, 2).join(" ");
  }

  if ((words[0] ?? "").startsWith("L'") && words[0].length > 2) {
    return words[0];
  }

  return words[0] ?? cleaned;
}

function findBusConnectionRoutes(legs: BusLeg[], origin: string, destination: string) {
  const byOriginCity = groupBusLegsByOriginCity(legs);
  const routes: BusRouteOption[] = [];
  const firstLegs = legs
    .filter((leg) => busStationMatches(leg.origin, origin) && !busStationMatches(leg.destination, destination))
    .sort(compareBusLegs)
    .slice(0, 140);

  for (const firstLeg of firstLegs) {
    const candidates = byOriginCity.get(placeCityKey(firstLeg.destination)) ?? [];
    for (const secondLeg of candidates) {
      if (!busStationMatches(secondLeg.destination, destination)) {
        continue;
      }

      const waitMinutes = busDepartureMinute(secondLeg) - busArrivalMinute(firstLeg);
      if (waitMinutes < MIN_BUS_TRANSFER_MINUTES || waitMinutes > MAX_CONNECTION_WAIT_MINUTES) {
        continue;
      }

      if (placeCityKey(secondLeg.destination) === placeCityKey(firstLeg.origin)) {
        continue;
      }

      routes.push(busRouteFromLegs([firstLeg, secondLeg]));
      if (routes.length >= 60) {
        return routes;
      }
    }
  }

  return routes;
}

function groupBusLegsByOriginCity(legs: BusLeg[]) {
  const groups = new Map<string, BusLeg[]>();

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
    group.sort(compareBusLegs);
  }

  return groups;
}

function busRouteFromLegs(legs: BusLeg[]): BusRouteOption {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const waitMinutes =
    legs.length === 1
      ? 0
      : legs.slice(1).reduce((sum, leg, index) => sum + busDepartureMinute(leg) - busArrivalMinute(legs[index]), 0);
  const departure = busDepartureMinute(first);
  const arrival = busArrivalMinute(last);

  return {
    id: legs.map((leg) => leg.id).join("|"),
    type: legs.length === 1 ? "direct" : "connection",
    legs,
    waitMinutes,
    durationMinutes: arrival - departure,
    departureDate: first.departureDate,
    arrivalDate: last.arrivalDate,
    providers: Array.from(new Set(legs.map((leg) => leg.provider)))
  };
}

function dedupeBusRoutes(routes: BusRouteOption[]) {
  return Array.from(new Map(routes.map((route) => [route.id, route])).values());
}

function compareBusRoutes(a: BusRouteOption, b: BusRouteOption) {
  return (
    a.legs.length - b.legs.length ||
    a.durationMinutes - b.durationMinutes ||
    busDepartureMinute(a.legs[0]) - busDepartureMinute(b.legs[0])
  );
}

function compareBusLegs(a: BusLeg, b: BusLeg) {
  return (
    a.departureDate.localeCompare(b.departureDate) ||
    a.departureTime.localeCompare(b.departureTime) ||
    a.destination.localeCompare(b.destination, "fr") ||
    a.provider.localeCompare(b.provider)
  );
}

async function loadBusFeeds(providers?: BusProvider[], options?: { refresh?: boolean }) {
  const selectedProviders = normalizeBusProviders(providers);
  return Promise.all(selectedProviders.map((provider) => loadBusFeed(provider, options)));
}

async function loadBusFeed(provider: BusProvider, options?: { refresh?: boolean }) {
  const now = Date.now();
  const cache = providerCaches.get(provider);
  if (!options?.refresh && cache?.data && cache.expiresAt > now) {
    return cache.data;
  }

  if (!options?.refresh && cache?.promise) {
    return cache.promise;
  }

  const promise = fetchAndParseBusFeed(provider, options);
  providerCaches.set(provider, {
    expiresAt: now + IN_MEMORY_CACHE_MS,
    promise
  });

  try {
    const data = await promise;
    providerCaches.set(provider, {
      data,
      expiresAt: Date.now() + IN_MEMORY_CACHE_MS
    });
    return data;
  } catch (error) {
    providerCaches.delete(provider);
    throw error;
  }
}

async function fetchAndParseBusFeed(provider: BusProvider, options?: { refresh?: boolean }) {
  const feed = BUS_FEEDS[provider];
  const response = await fetch(feed.url, {
    cache: options?.refresh ? "no-store" : undefined,
    next: options?.refresh
      ? undefined
      : {
          revalidate: 60 * 60 * 6,
          tags: [BUS_CACHE_TAG]
        }
  } as RequestInit & { next?: { revalidate: number; tags: string[] } });

  if (!response.ok) {
    throw new Error(`${feed.label} GTFS returned ${response.status}`);
  }

  const files = unzipSelectedFiles(Buffer.from(await response.arrayBuffer()), REQUIRED_GTFS_FILES);
  return parseBusFeed(provider, feed.label, files);
}

function parseBusFeed(provider: BusProvider, providerLabel: string, files: Map<string, string>): ParsedBusFeed {
  const stops = parseStops(files.get("stops.txt") ?? "");
  const routes = parseRoutes(files.get("routes.txt") ?? "");
  const trips = parseTrips(files.get("trips.txt") ?? "");
  const stopTimesByTrip = parseStopTimes(files.get("stop_times.txt") ?? "", trips);
  const serviceRules = parseCalendar(files.get("calendar.txt") ?? "");
  const exceptionsByDate = parseCalendarDates(files.get("calendar_dates.txt") ?? "");

  return {
    provider,
    providerLabel,
    checkedAt: new Date().toISOString(),
    stops,
    routes,
    trips,
    stopTimesByTrip,
    serviceRules,
    exceptionsByDate,
    legsByDate: new Map()
  };
}

function parseStops(text: string) {
  const stops = new Map<string, GtfsStop>();

  for (const row of parseGtfsCsv(text)) {
    const id = toText(row.stop_id);
    const name = toText(row.stop_name);
    if (!id || !name) {
      continue;
    }

    stops.set(id, {
      id,
      name,
      city: placeCityLabel(name),
      lat: toNumberOrNull(row.stop_lat),
      lon: toNumberOrNull(row.stop_lon)
    });
  }

  return stops;
}

function parseRoutes(text: string) {
  const routes = new Map<string, GtfsRoute>();

  for (const row of parseGtfsCsv(text)) {
    const id = toText(row.route_id);
    if (!id) {
      continue;
    }

    routes.set(id, {
      id,
      name: toText(row.route_long_name) || toText(row.route_short_name) || id
    });
  }

  return routes;
}

function parseTrips(text: string) {
  const trips = new Map<string, GtfsTrip>();

  for (const row of parseGtfsCsv(text)) {
    const id = toText(row.trip_id);
    const serviceId = toText(row.service_id);
    const routeId = toText(row.route_id);
    if (!id || !serviceId || !routeId) {
      continue;
    }

    trips.set(id, {
      id,
      routeId,
      serviceId,
      headsign: toText(row.trip_headsign)
    });
  }

  return trips;
}

function parseStopTimes(text: string, trips: Map<string, GtfsTrip>) {
  const stopTimesByTrip = new Map<string, GtfsStopTime[]>();

  for (const row of parseGtfsCsv(text)) {
    const tripId = toText(row.trip_id);
    if (!tripId || !trips.has(tripId)) {
      continue;
    }

    const stopId = toText(row.stop_id);
    const departureMinutes = gtfsTimeToMinutes(toText(row.departure_time));
    const arrivalMinutes = gtfsTimeToMinutes(toText(row.arrival_time));
    const sequence = Number(row.stop_sequence ?? 0);

    if (!stopId || !Number.isFinite(sequence) || departureMinutes === null || arrivalMinutes === null) {
      continue;
    }

    const stopTimes = stopTimesByTrip.get(tripId) ?? [];
    stopTimes.push({
      tripId,
      stopId,
      sequence,
      arrivalMinutes,
      departureMinutes
    });
    stopTimesByTrip.set(tripId, stopTimes);
  }

  for (const stopTimes of stopTimesByTrip.values()) {
    stopTimes.sort((a, b) => a.sequence - b.sequence);
  }

  return stopTimesByTrip;
}

function parseCalendar(text: string) {
  const rules: CalendarRule[] = [];

  for (const row of parseGtfsCsv(text)) {
    const serviceId = toText(row.service_id);
    const startDate = toText(row.start_date);
    const endDate = toText(row.end_date);
    if (!serviceId || !startDate || !endDate) {
      continue;
    }

    rules.push({
      serviceId,
      startDate,
      endDate,
      weekdays: [
        row.sunday === "1",
        row.monday === "1",
        row.tuesday === "1",
        row.wednesday === "1",
        row.thursday === "1",
        row.friday === "1",
        row.saturday === "1"
      ]
    });
  }

  return rules;
}

function parseCalendarDates(text: string) {
  const exceptions = new Map<string, Map<string, number>>();

  for (const row of parseGtfsCsv(text)) {
    const serviceId = toText(row.service_id);
    const date = toText(row.date);
    const exceptionType = Number(row.exception_type);
    if (!serviceId || !date || ![1, 2].includes(exceptionType)) {
      continue;
    }

    const dateExceptions = exceptions.get(date) ?? new Map<string, number>();
    dateExceptions.set(serviceId, exceptionType);
    exceptions.set(date, dateExceptions);
  }

  return exceptions;
}

function buildLegsForFeedDate(feed: ParsedBusFeed, date: string) {
  const cachedLegs = feed.legsByDate.get(date);
  if (cachedLegs) {
    return cachedLegs;
  }

  const activeServices = getActiveServiceIds(feed, date);
  const legs: BusLeg[] = [];

  for (const trip of feed.trips.values()) {
    if (!activeServices.has(trip.serviceId)) {
      continue;
    }

    const stopTimes = feed.stopTimesByTrip.get(trip.id);
    if (!stopTimes || stopTimes.length < 2) {
      continue;
    }

    const route = feed.routes.get(trip.routeId);
    for (let originIndex = 0; originIndex < stopTimes.length - 1; originIndex += 1) {
      const originTime = stopTimes[originIndex];
      const originStop = feed.stops.get(originTime.stopId);
      if (!originStop) {
        continue;
      }

      for (let destinationIndex = originIndex + 1; destinationIndex < stopTimes.length; destinationIndex += 1) {
        const destinationTime = stopTimes[destinationIndex];
        const destinationStop = feed.stops.get(destinationTime.stopId);
        if (!destinationStop) {
          continue;
        }

        const durationMinutes = destinationTime.arrivalMinutes - originTime.departureMinutes;
        if (durationMinutes <= 0 || durationMinutes > 36 * 60) {
          continue;
        }

        const departureDate = addDays(date, Math.floor(originTime.departureMinutes / 1440));
        const arrivalDate = addDays(date, Math.floor(destinationTime.arrivalMinutes / 1440));
        const departureTime = minutesToClock(originTime.departureMinutes);
        const arrivalTime = minutesToClock(destinationTime.arrivalMinutes);

        legs.push({
          id: [
            feed.provider,
            trip.id,
            originTime.stopId,
            destinationTime.stopId,
            departureDate,
            departureTime
          ].join(":"),
          provider: feed.provider,
          providerLabel: feed.providerLabel,
          routeId: trip.routeId,
          routeName: route?.name || trip.headsign || feed.providerLabel,
          tripId: trip.id,
          date: departureDate,
          departureDate,
          arrivalDate,
          origin: originStop.name,
          destination: destinationStop.name,
          originCity: originStop.city,
          destinationCity: destinationStop.city,
          originLat: originStop.lat,
          originLon: originStop.lon,
          destinationLat: destinationStop.lat,
          destinationLon: destinationStop.lon,
          departureTime,
          arrivalTime,
          durationMinutes
        });
      }
    }
  }

  const sortedLegs = legs.sort(compareBusLegs);
  feed.legsByDate.set(date, sortedLegs);
  return sortedLegs;
}

function getActiveServiceIds(feed: ParsedBusFeed, date: string) {
  const gtfsDate = date.replaceAll("-", "");
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const active = new Set<string>();

  for (const rule of feed.serviceRules) {
    if (rule.startDate <= gtfsDate && gtfsDate <= rule.endDate && rule.weekdays[weekday]) {
      active.add(rule.serviceId);
    }
  }

  const exceptions = feed.exceptionsByDate.get(gtfsDate);
  if (exceptions) {
    for (const [serviceId, exceptionType] of exceptions) {
      if (exceptionType === 1) {
        active.add(serviceId);
      } else if (exceptionType === 2) {
        active.delete(serviceId);
      }
    }
  }

  return active;
}

function unzipSelectedFiles(buffer: Buffer, names: string[]) {
  const wantedNames = new Set(names);
  const entries = readZipCentralDirectory(buffer);
  const files = new Map<string, string>();

  for (const entry of entries) {
    const normalizedName = entry.name.replace(/\\/g, "/").split("/").pop() ?? entry.name;
    if (!wantedNames.has(normalizedName)) {
      continue;
    }

    files.set(normalizedName, readZipEntry(buffer, entry).replace(/^\uFEFF/, ""));
  }

  for (const name of names.slice(0, 4)) {
    if (!files.has(name)) {
      throw new Error(`GTFS file ${name} is missing.`);
    }
  }

  return files;
}

function readZipCentralDirectory(buffer: Buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid GTFS ZIP central directory.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.push({
      compressedSize,
      localHeaderOffset,
      method,
      name,
      uncompressedSize
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid GTFS ZIP local file header for ${entry.name}.`);
  }

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    return compressed.toString("utf8");
  }

  if (entry.method === 8) {
    const inflated = inflateRawSync(compressed, {
      finishFlush: 2
    });
    if (entry.uncompressedSize && inflated.length !== entry.uncompressedSize) {
      return inflated.toString("utf8");
    }
    return inflated.toString("utf8");
  }

  throw new Error(`Unsupported GTFS ZIP compression method ${entry.method}.`);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("GTFS ZIP end of central directory was not found.");
}

function parseGtfsCsv(text: string) {
  const rows = parseCsvRows(text);
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows
    .filter((row) => row.some((field) => field.trim()))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function addAllStationsSuggestions(stations: string[]) {
  const byCity = new Map<string, { label: string; count: number }>();

  for (const station of stations) {
    const city = placeCityLabel(station);
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

  return Array.from(new Set([...citySuggestions, ...stations]));
}

function allStationsCity(value: string) {
  const match = value.trim().match(/^(.+?)\s+\((all stations|intramuros)\)$/i);
  return match?.[1]?.trim() ?? "";
}

function checkedAtForFeeds(feeds: ParsedBusFeed[]) {
  const dates = feeds.map((feed) => feed.checkedAt).sort();
  return dates[dates.length - 1] ?? new Date().toISOString();
}

function gtfsTimeToMinutes(value: string) {
  const match = value.match(/^(\d{1,3}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToClock(minutes: number) {
  const localMinutes = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(localMinutes / 60);
  const minute = localMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateIndex(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function timeToMinutes(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function toNumberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeText(value: unknown) {
  return stripAccents(toText(value)).toLowerCase();
}

function looseTextMatches(value: string, query: string) {
  const normalizedValue = normalizeText(value);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }

  if (normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery)) {
    return true;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 1);
  return queryTokens.length > 0 && queryTokens.every((token) => normalizedValue.includes(token));
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
