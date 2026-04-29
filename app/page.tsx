"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { RouteOption, TrainAvailability } from "@/lib/sncf";

type SearchMode = "outbound" | "inbound" | "route";
type Status = "idle" | "loading" | "success" | "empty" | "error";
type RouteDateMode = "specific" | "flexible" | "range";

type TrainsResponse = {
  trains: TrainAvailability[];
  checkedAt: string;
  totalCount: number;
  error?: string;
};

type SuggestionsResponse = {
  origins?: string[];
  destinations?: string[];
  checkedAt: string;
  error?: string;
};

type RoutesResponse = {
  routes: RouteOption[];
  checkedAt: string;
  searchedFrom: string;
  searchedTo: string;
  error?: string;
};

type GroupedResults = Array<{
  date: string;
  places: Array<{
    place: string;
    trains: TrainAvailability[];
  }>;
}>;

type MapPoint = {
  name: string;
  place: string;
  lat: number;
  lon: number;
  kind: "focus" | "available" | "one-leg" | "two-leg" | "three-leg";
  count: number;
};

type RouteMapPoint = MapPoint & {
  order: number;
};

type LabeledPoint<T extends MapPoint = MapPoint> = T & {
  marker: string;
};

type ReachableCityGroup = {
  city: string;
  routes: RouteOption[];
};

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  AIX: { lat: 43.5297, lon: 5.4474 },
  ANGERS: { lat: 47.4784, lon: -0.5632 },
  ANNECY: { lat: 45.8992, lon: 6.1294 },
  ARRAS: { lat: 50.291, lon: 2.7775 },
  AVIGNON: { lat: 43.9493, lon: 4.8055 },
  BARDEAUX: { lat: 44.8378, lon: -0.5792 },
  BESANCON: { lat: 47.2378, lon: 6.0241 },
  BORDEAUX: { lat: 44.8378, lon: -0.5792 },
  BREST: { lat: 48.3904, lon: -4.4861 },
  CHAMBERY: { lat: 45.5646, lon: 5.9178 },
  DIJON: { lat: 47.322, lon: 5.0415 },
  GRENOBLE: { lat: 45.1885, lon: 5.7245 },
  "LA ROCHELLE": { lat: 46.1603, lon: -1.1511 },
  LAVAL: { lat: 48.0707, lon: -0.7734 },
  "LE MANS": { lat: 48.0061, lon: 0.1996 },
  LILLE: { lat: 50.6292, lon: 3.0573 },
  LORRAINE: { lat: 48.9473, lon: 6.1696 },
  LYON: { lat: 45.764, lon: 4.8357 },
  MARNE: { lat: 48.8706, lon: 2.7828 },
  MARSEILLE: { lat: 43.2965, lon: 5.3698 },
  MASSY: { lat: 48.7309, lon: 2.2713 },
  METZ: { lat: 49.1193, lon: 6.1757 },
  MONTPELLIER: { lat: 43.6119, lon: 3.8772 },
  MULHOUSE: { lat: 47.7508, lon: 7.3359 },
  NANCY: { lat: 48.6921, lon: 6.1844 },
  NANTES: { lat: 47.2184, lon: -1.5536 },
  NICE: { lat: 43.7102, lon: 7.262 },
  NIMES: { lat: 43.8367, lon: 4.3601 },
  PARIS: { lat: 48.8566, lon: 2.3522 },
  PERPIGNAN: { lat: 42.6887, lon: 2.8948 },
  POITIERS: { lat: 46.5802, lon: 0.3404 },
  QUIMPER: { lat: 47.996, lon: -4.1028 },
  REIMS: { lat: 49.2583, lon: 4.0317 },
  RENNES: { lat: 48.1173, lon: -1.6778 },
  "ROISSY": { lat: 49.0097, lon: 2.5479 },
  "SAINT ETIENNE": { lat: 45.4397, lon: 4.3872 },
  STRASBOURG: { lat: 48.5734, lon: 7.7521 },
  TOULON: { lat: 43.1242, lon: 5.928 },
  TOULOUSE: { lat: 43.6047, lon: 1.4442 },
  TOURS: { lat: 47.3941, lon: 0.6848 },
  VALENCE: { lat: 44.9334, lon: 4.8924 }
};

const FRANCE_OUTLINE: Array<[number, number]> = [
  [-4.78, 48.53],
  [-3.64, 48.85],
  [-1.56, 49.68],
  [1.25, 50.95],
  [2.73, 50.73],
  [4.17, 49.99],
  [6.13, 49.46],
  [7.7, 48.6],
  [7.58, 47.58],
  [6.84, 47.0],
  [6.94, 45.93],
  [7.51, 44.12],
  [6.63, 43.31],
  [5.35, 43.22],
  [3.04, 42.43],
  [1.45, 42.62],
  [0.26, 42.78],
  [-1.76, 43.36],
  [-1.43, 44.65],
  [-1.23, 45.72],
  [-2.03, 46.84],
  [-4.22, 47.81],
  [-4.78, 48.53]
];

const CORSICA_OUTLINE: Array<[number, number]> = [
  [8.58, 43.01],
  [9.42, 42.8],
  [9.55, 42.12],
  [9.2, 41.45],
  [8.72, 41.36],
  [8.55, 42.12],
  [8.58, 43.01]
];

const MAP_BOUNDS = {
  minLat: 41.0,
  maxLat: 51.4,
  minLon: -5.6,
  maxLon: 10.1
};

export default function Home() {
  const [mode, setMode] = useState<SearchMode>("outbound");
  const [station, setStation] = useState("");
  const [date, setDate] = useState("");
  const [nightOnly, setNightOnly] = useState(false);
  const [reachableLegs, setReachableLegs] = useState(1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [trains, setTrains] = useState<TrainAvailability[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [routeOrigin, setRouteOrigin] = useState("");
  const [routeDestination, setRouteDestination] = useState("");
  const [routeDateMode, setRouteDateMode] = useState<RouteDateMode>("specific");
  const [routeDate, setRouteDate] = useState("");
  const [routeEndDate, setRouteEndDate] = useState("");
  const [routeMaxLegs, setRouteMaxLegs] = useState(2);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [routeOriginSuggestions, setRouteOriginSuggestions] = useState<string[]>([]);
  const [routeDestinationSuggestions, setRouteDestinationSuggestions] = useState<string[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const today = todayInputValue();
    setDate(today);
    setRouteDate(today);
    setRouteEndDate(addDaysInput(today, 7));
  }, []);

  useEffect(() => {
    setSuggestions([]);
    setTrains([]);
    setRoutes([]);
    setReachableLegs(1);
    setStatus("idle");
    setError("");
    setRouteMaxLegs(2);
  }, [mode]);

  useEffect(() => {
    if (mode === "route" || station.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const endpoint = mode === "outbound" ? "/api/origins" : "/api/destinations";
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`${endpoint}?q=${encodeURIComponent(station)}`, {
          signal: controller.signal
        });
        const data = (await response.json()) as SuggestionsResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load station suggestions.");
        }

        setSuggestions(mode === "outbound" ? (data.origins ?? []) : (data.destinations ?? []));
        setCheckedAt(data.checkedAt);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [mode, station]);

  useEffect(() => {
    if (mode !== "route") {
      return;
    }

    loadRouteSuggestions(routeOrigin, "origin", setRouteOriginSuggestions);
  }, [mode, routeOrigin]);

  useEffect(() => {
    if (mode !== "route") {
      return;
    }

    loadRouteSuggestions(routeDestination, "destination", setRouteDestinationSuggestions);
  }, [mode, routeDestination]);

  const groupedResults = useMemo(() => groupTrains(trains, mode), [mode, trains]);
  const mapPoints = useMemo(() => buildMapPoints(trains, station, mode), [mode, station, trains]);
  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? routes[0],
    [routes, selectedRouteId]
  );
  const firstPlaceDates = useMemo(() => getFirstPlaceDates(groupedResults), [groupedResults]);

  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!station.trim()) {
      setError(mode === "outbound" ? "Choose an origin station." : "Choose an arrival station.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");
    setSuggestions([]);

    if (reachableLegs) {
      await searchReachable();
      return;
    }

    const params = new URLSearchParams({ direction: mode });
    params.set(mode === "outbound" ? "origin" : "destination", station.trim());
    if (nightOnly) {
      params.set("nightOnly", "true");
    }
    if (date) {
      params.set("date", date);
    }

    try {
      const response = await fetch(`/api/trains?${params}`);
      const data = (await response.json()) as TrainsResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "SNCF data could not be loaded.");
      }

      setTrains(data.trains);
      setCheckedAt(data.checkedAt);
      setStatus(data.trains.length ? "success" : "empty");
    } catch (requestError) {
      setTrains([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "SNCF data could not be loaded."
      );
      setStatus("error");
    }
  }

  async function searchReachable() {
    const params = new URLSearchParams({
      direction: mode === "inbound" ? "inbound" : "outbound",
      station: station.trim(),
      maxLegs: String(reachableLegs)
    });

    if (date) {
      params.set("date", date);
    }

    try {
      const response = await fetch(`/api/reachable?${params}`);
      const data = (await response.json()) as RoutesResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Reachable routes could not be searched.");
      }

      const matchingRoutes = data.routes.filter((route) => route.legs.length === reachableLegs);
      const filteredRoutes =
        reachableLegs === 1 ? sortReachableRoutes(matchingRoutes, mode) : bestRoutesByCity(matchingRoutes, mode);
      setRoutes(filteredRoutes);
      setSelectedRouteId(filteredRoutes[0]?.id ?? "");
      setCheckedAt(data.checkedAt);
      setStatus(filteredRoutes.length ? "success" : "empty");
    } catch (requestError) {
      setRoutes([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Reachable routes could not be searched."
      );
      setStatus("error");
    }
  }

  async function searchRoute(event?: FormEvent<HTMLFormElement>, nextMaxLegs = routeMaxLegs) {
    event?.preventDefault();

    if (!routeOrigin.trim() || !routeDestination.trim()) {
      setError("Choose both origin and destination.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");
    setRoutes([]);

    const params = new URLSearchParams({
      origin: routeOrigin.trim(),
      destination: routeDestination.trim(),
      mode: routeDateMode,
      maxLegs: String(routeDateMode === "range" ? 1 : nextMaxLegs)
    });

    if (routeDateMode === "specific") {
      params.set("date", routeDate);
    } else if (routeDateMode === "flexible") {
      params.set("startDate", routeDate);
    } else {
      params.set("startDate", routeDate);
      params.set("endDate", routeEndDate);
    }

    try {
      const response = await fetch(`/api/routes?${params}`);
      const data = (await response.json()) as RoutesResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "SNCF routes could not be searched.");
      }

      setRoutes(data.routes);
      setSelectedRouteId(data.routes[0]?.id ?? "");
      setRouteMaxLegs(nextMaxLegs);
      setCheckedAt(data.checkedAt);
      setStatus(data.routes.length ? "success" : "empty");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "SNCF routes could not be searched."
      );
      setStatus("error");
    }
  }

  async function searchWithMoreLegs() {
    await searchRoute(undefined, Math.min(routeMaxLegs + 1, 4));
  }

  async function refresh() {
    setRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      const data = (await response.json()) as Partial<TrainsResponse> & { ok?: boolean };

      if (!response.ok) {
        throw new Error(data.error ?? "SNCF data could not be refreshed.");
      }

      setCheckedAt(data.checkedAt ?? new Date().toISOString());
      if (station.trim()) {
        await search();
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "SNCF data could not be refreshed."
      );
      setStatus("error");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="shell">
      <main className="main">
        <div className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              TV
            </div>
            <div>
              <h1>TGVMax Finder</h1>
              <p>Available MAX JEUNE and MAX SENIOR seats from SNCF Open Data.</p>
            </div>
          </div>
          <button className="refresh-button" disabled={refreshing} onClick={refresh} type="button">
            {refreshing ? "Refreshing..." : "Refresh SNCF data"}
          </button>
        </div>

        <section className="search-band" aria-labelledby="search-title">
          <div className="tabs" role="tablist" aria-label="Search mode">
            <button
              aria-selected={mode === "outbound"}
              className={mode === "outbound" ? "tab active" : "tab"}
              onClick={() => setMode("outbound")}
              role="tab"
              type="button"
            >
              From a city
            </button>
            <button
              aria-selected={mode === "inbound"}
              className={mode === "inbound" ? "tab active" : "tab"}
              onClick={() => setMode("inbound")}
              role="tab"
              type="button"
            >
              To a city
            </button>
            <button
              aria-selected={mode === "route"}
              className={mode === "route" ? "tab active" : "tab"}
              onClick={() => setMode("route")}
              role="tab"
              type="button"
            >
              Route
            </button>
          </div>

          <div className="intro">
            <h2 id="search-title">
              {mode === "outbound"
                ? "Find free MAX trains from your station."
                : mode === "inbound"
                  ? "Find free MAX trains arriving at your station."
                  : "Find a free MAX route between two cities."}
            </h2>
            <p>
              {mode === "outbound"
                ? "Pick an origin and see every available destination."
                : mode === "inbound"
                  ? "Pick an arrival city and see every available departure city."
                  : "Search direct trains first, then same-day or flexible connections with at least 15m between legs."}
            </p>
          </div>

          {mode !== "route" ? (
          <form className="search-form" onSubmit={search}>
            <div className="field">
              <label htmlFor="station">
                {mode === "outbound" ? "Origin station" : "Arrival station"}
              </label>
              <input
                autoComplete="off"
                id="station"
                onChange={(event) => setStation(event.target.value)}
                placeholder="Paris, Lyon, Nantes..."
                type="text"
                value={station}
              />
              {suggestions.length > 0 ? (
                <div className="suggestions" role="listbox">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setStation(suggestion);
                        setSuggestions([]);
                      }}
                      type="button"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="date">Travel date</label>
              <input
                id="date"
                onChange={(event) => setDate(event.target.value)}
                type="date"
                value={date}
              />
            </div>

            <button className="primary-button" disabled={status === "loading"} type="submit">
              {status === "loading" ? "Searching..." : "Search trains"}
            </button>
          </form>
          ) : (
            <form className="route-form" onSubmit={(event) => searchRoute(event, 2)}>
              <StationInput
                id="route-origin"
                label="Origin"
                onChange={setRouteOrigin}
                onPick={(value) => {
                  setRouteOrigin(value);
                  setRouteOriginSuggestions([]);
                }}
                placeholder="Paris..."
                suggestions={routeOriginSuggestions}
                value={routeOrigin}
              />
              <StationInput
                id="route-destination"
                label="Destination"
                onChange={setRouteDestination}
                onPick={(value) => {
                  setRouteDestination(value);
                  setRouteDestinationSuggestions([]);
                }}
                placeholder="Marseille..."
                suggestions={routeDestinationSuggestions}
                value={routeDestination}
              />
              <div className="field">
                <label htmlFor="route-mode">Date mode</label>
                <select
                  id="route-mode"
                  onChange={(event) => setRouteDateMode(event.target.value as RouteDateMode)}
                  value={routeDateMode}
                >
                  <option value="specific">Specific date</option>
                  <option value="flexible">Flexible from date</option>
                  <option value="range">Available period</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="route-date">
                  {routeDateMode === "specific" ? "Travel date" : "Start date"}
                </label>
                <input
                  id="route-date"
                  onChange={(event) => setRouteDate(event.target.value)}
                  type="date"
                  value={routeDate}
                />
              </div>
              {routeDateMode === "range" ? (
                <div className="field">
                  <label htmlFor="route-end-date">End date</label>
                  <input
                    id="route-end-date"
                    onChange={(event) => setRouteEndDate(event.target.value)}
                    type="date"
                    value={routeEndDate}
                  />
                </div>
              ) : null}
              <button
                className="primary-button"
                disabled={status === "loading"}
                type="submit"
              >
                {status === "loading" ? "Searching..." : "Find route"}
              </button>
            </form>
          )}

          {mode !== "route" ? (
            <label className="check-row">
              <input
                checked={nightOnly}
                onChange={(event) => setNightOnly(event.target.checked)}
                type="checkbox"
              />
              Night Intercites only
            </label>
          ) : null}

          {mode !== "route" ? (
            <div className="leg-filter" aria-label="Reachable train count">
              <span>Map</span>
              {[1, 2, 3].map((legCount) => (
                <label className={reachableLegs === legCount ? "active" : ""} key={legCount}>
                  <input
                    checked={reachableLegs === legCount}
                    onChange={() => setReachableLegs(legCount)}
                    name="reachable-legs"
                    type="radio"
                  />
                  {legCount} train{legCount > 1 ? "s" : ""}
                </label>
              ))}
            </div>
          ) : null}

          <div className="meta-row">
            <span>
              {checkedAt ? `Last checked: ${formatCheckedAt(checkedAt)}` : "Ready to search."}
            </span>
            <span>Rolling SNCF availability window: 30 days.</span>
          </div>
        </section>

        <p className="notice">
          This availability helper is not a booking service. Always confirm the seat on SNCF
          Connect before planning your trip.
        </p>

        <section className="results" aria-live="polite">
          {status === "idle" ? (
            <div className="message">
              <strong>
                {mode === "outbound"
                  ? "Start with an origin station."
                  : mode === "inbound"
                    ? "Start with an arrival station."
                    : "Start with an origin and destination."}
              </strong>
              Try official names or city-wide options such as PARIS (all stations).
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="message">
              <strong>Searching SNCF availability...</strong>
              Checking the current MAX dataset for matching trains.
            </div>
          ) : null}

          {status === "empty" ? (
            <div className="message">
              <strong>No available MAX trains found.</strong>
              {mode === "route"
                ? routeDateMode === "range"
                  ? "No direct train was found inside this period."
                  : `No route was found with up to ${routeMaxLegs} legs.`
                : reachableLegs
                  ? "No reachable city was found with up to 3 legs for this date."
                : `SNCF Open Data has no available MAX seats for this search${date ? " on the selected date" : ""}.`}
              {mode === "route" && routeDateMode !== "range" && routeMaxLegs < 4 ? (
                <div className="heavy-search">
                  <span>
                    Search with up to {routeMaxLegs + 1} legs? This can be heavier and may take longer.
                  </span>
                  <button onClick={searchWithMoreLegs} type="button">
                    Try {routeMaxLegs + 1} legs
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {status === "error" ? (
            <div className="message">
              <strong>SNCF data could not be loaded.</strong>
              {error || "Please retry or refresh the SNCF data."}
            </div>
          ) : null}

          {status === "success" && mode !== "route" && !reachableLegs ? (
            <AvailabilityMap points={mapPoints} mode={mode} />
          ) : null}

          {status === "success" && mode !== "route" && reachableLegs ? (
            <ReachableMap routes={routes} mode={mode} station={station} />
          ) : null}

          {status === "success" && mode === "route" && selectedRoute ? (
            <RouteMap route={selectedRoute} />
          ) : null}

          {status === "success" && (mode === "route" || reachableLegs) ? (
            reachableLegs && mode !== "route" ? (
              <ReachableResults
                mode={mode}
                onSelect={setSelectedRouteId}
                routes={routes}
                selectedRouteId={selectedRoute?.id ?? ""}
              />
            ) : (
              <RouteResults
                onSelect={setSelectedRouteId}
                routes={routes}
                selectedRouteId={selectedRoute?.id ?? ""}
              />
            )
          ) : null}

          {status === "success" && mode !== "route" && !reachableLegs
            ? groupedResults.map((day) => (
                <div className="day-group" key={day.date}>
                  <div className="day-heading">
                    <h3>{formatDate(day.date)}</h3>
                    <span>{countDayTrains(day)} available trains</span>
                  </div>

                  {day.places.map((placeGroup) => (
                    <div
                      className="destination-group"
                      id={
                        firstPlaceDates.get(placeGroup.place) === day.date
                          ? placeAnchorId(placeGroup.place)
                          : undefined
                      }
                      key={`${day.date}:${placeGroup.place}`}
                    >
                      <h4 className="destination-title">
                        {mode === "outbound" ? "To" : "From"} {placeGroup.place}
                      </h4>
                      <div className="train-grid">
                        {placeGroup.trains.map((train) => (
                          <article className="train-card" key={train.id}>
                            <header>
                              <span className="train-number">Train {train.trainNo}</span>
                              <span className="badge">MAX available</span>
                            </header>
                            <div className="times">
                              <div className="time">
                                <strong>{train.departureTime}</strong>
                                <span>{train.origin}</span>
                              </div>
                              <div className="route-line" aria-hidden="true" />
                              <div className="time">
                                <strong>{train.arrivalTime}</strong>
                                <span>{train.destination}</span>
                              </div>
                            </div>
                            <div className="card-footer">
                              <span>{train.entity || "SNCF"}</span>
                              <span>{train.axe || train.destinationCode || "MAX"}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            : null}
        </section>
      </main>
    </div>
  );
}

function StationInput({
  id,
  label,
  onChange,
  onPick,
  placeholder,
  suggestions,
  value
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  onPick: (value: string) => void;
  placeholder: string;
  suggestions: string[];
  value: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        autoComplete="off"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {suggestions.length > 0 ? (
        <div className="suggestions" role="listbox">
          {suggestions.map((suggestion) => (
            <button key={suggestion} onClick={() => onPick(suggestion)} type="button">
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RouteResults({
  onSelect,
  routes,
  selectedRouteId
}: {
  onSelect: (routeId: string) => void;
  routes: RouteOption[];
  selectedRouteId: string;
}) {
  return (
    <div className="route-results">
      {routes.map((route) => (
        <article
          className={route.id === selectedRouteId ? "route-option selected" : "route-option"}
          key={route.id}
          onClick={() => onSelect(route.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(route.id);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <header>
            <div>
              <strong>{route.type === "direct" ? "Direct train" : "Connection found"}</strong>
              <span>
                {formatDuration(route.durationMinutes)}
                {route.waitMinutes ? `, including ${formatDuration(route.waitMinutes)} waiting` : ""}
              </span>
            </div>
            <span className="badge">{route.legs.length} leg{route.legs.length > 1 ? "s" : ""}</span>
          </header>
          <div className="route-legs">
            {route.legs.map((leg, index) => (
              <div className="route-leg" key={leg.id}>
                <span className="leg-index">{index + 1}</span>
                <div>
                  <strong>
                    {leg.origin} {"->"} {leg.destination}
                  </strong>
                  <span>
                    {formatDate(leg.date)} · {leg.departureTime} to {leg.arrivalTime} · Train{" "}
                    {leg.trainNo}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ReachableResults({
  mode,
  onSelect,
  routes,
  selectedRouteId
}: {
  mode: SearchMode;
  onSelect: (routeId: string) => void;
  routes: RouteOption[];
  selectedRouteId: string;
}) {
  const groups = groupReachableRoutes(routes, mode);

  return (
    <div className="reachable-results">
      {groups.map((group) => (
        <section className="reachable-group" id={reachableAnchorId(group.city)} key={group.city}>
          <div className="day-heading">
            <h3>{mode === "inbound" ? "From" : "To"} {group.city}</h3>
            <span>{group.routes.length} option{group.routes.length > 1 ? "s" : ""}</span>
          </div>
          <RouteResults
            onSelect={onSelect}
            routes={group.routes}
            selectedRouteId={selectedRouteId}
          />
        </section>
      ))}
    </div>
  );
}

function RouteMap({ route }: { route: RouteOption }) {
  const points = buildRouteMapPoints(route);
  if (points.length < 2) {
    return (
      <div className="map-panel">
        <div className="map-heading">
          <h3>Route map</h3>
          <span>Coordinates unavailable for this route.</span>
        </div>
        <div className="map-empty">Select another route below.</div>
      </div>
    );
  }

  return (
    <div className="map-panel">
      <div className="map-heading">
        <h3>Route map</h3>
        <span>{route.legs.length === 1 ? "Direct route" : `${route.legs.length} legs selected`}</span>
      </div>
      <svg className="route-map" role="img" viewBox="0 0 760 420" aria-label="Selected route map">
        <rect width="760" height="420" rx="8" />
        <path className="france-shape" d={outlinePath(FRANCE_OUTLINE)} />
        <path className="france-shape corsica-shape" d={outlinePath(CORSICA_OUTLINE)} />
        <polyline
          className="selected-route-line"
          points={points
            .map((point) => {
              const position = projectPoint(point);
              return `${position.x},${position.y}`;
            })
            .join(" ")}
        />
        {numberMapPoints(points).map((point) => {
          const position = projectPoint(point);
          return (
            <g key={`${point.order}:${point.place}`} transform={`translate(${position.x} ${position.y})`}>
              <circle className={mapPointClass(point)} r={point.kind === "focus" ? 10 : 11} />
              <text className="marker-label" dy="4">{point.marker}</text>
            </g>
          );
        })}
      </svg>
      <MapIndex points={numberMapPoints(points)} />
    </div>
  );
}

function ReachableMap({
  mode,
  routes,
  station
}: {
  mode: SearchMode;
  routes: RouteOption[];
  station: string;
}) {
  const points = buildReachableMapPoints(routes, station, mode);
  if (points.length < 2) {
    return (
      <div className="map-panel">
        <div className="map-heading">
          <h3>Reachable map</h3>
          <span>Coordinates unavailable for these routes.</span>
        </div>
        <div className="map-empty">Routes are listed below.</div>
      </div>
    );
  }

  return (
    <div className="map-panel">
      <div className="map-heading">
        <h3>Reachable map</h3>
        <div className="map-legend">
          <span><i className="focus-dot" /> Selected city</span>
          <span><i className="one-leg-dot" /> 1 train</span>
          <span><i className="two-leg-dot" /> 2 trains</span>
          <span><i className="three-leg-dot" /> 3 trains</span>
        </div>
      </div>
      <svg className="route-map" role="img" viewBox="0 0 760 420" aria-label="Reachable cities map">
        <rect width="760" height="420" rx="8" />
        <path className="france-shape" d={outlinePath(FRANCE_OUTLINE)} />
        <path className="france-shape corsica-shape" d={outlinePath(CORSICA_OUTLINE)} />
        {numberMapPoints(points).map((point) => {
          const position = projectPoint(point);
          const radius = point.kind === "focus" ? 10 : 11;
          const canJump = point.kind !== "focus";
          return (
            <g
              className={canJump ? "map-point" : "map-point focus-map-point"}
              key={`${point.kind}:${point.place}`}
              onClick={canJump ? () => scrollToReachable(point.place) : undefined}
              onKeyDown={(event) => {
                if (canJump && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  scrollToReachable(point.place);
                }
              }}
              role={canJump ? "button" : undefined}
              tabIndex={canJump ? 0 : undefined}
              transform={`translate(${position.x} ${position.y})`}
            >
              <circle className={mapPointClass(point)} r={radius} />
              <text className="marker-label" dy="4">{point.marker}</text>
            </g>
          );
        })}
      </svg>
      <MapIndex points={numberMapPoints(points)} clickable />
    </div>
  );
}

function MapIndex({
  clickable,
  points
}: {
  clickable?: boolean;
  points: Array<LabeledPoint<MapPoint>>;
}) {
  const visiblePoints = points.filter((point) => point.kind !== "focus");
  if (!visiblePoints.length) {
    return null;
  }

  return (
    <div className="map-index">
      {visiblePoints.map((point) => (
        <button
          className="map-index-item"
          disabled={false}
          key={`${point.marker}:${point.place}`}
          onClick={() => {
            if (clickable) {
              scrollToReachable(point.place);
            } else {
              scrollToPlace(point.place);
            }
          }}
          type="button"
        >
          <span className={mapPointClass(point)}>{point.marker}</span>
          <strong>{point.name}</strong>
          <em>{point.count} option{point.count > 1 ? "s" : ""}</em>
        </button>
      ))}
    </div>
  );
}

function AvailabilityMap({ points, mode }: { points: MapPoint[]; mode: SearchMode }) {
  if (points.length < 2) {
    return (
      <div className="map-panel">
        <div className="map-heading">
          <h3>Map</h3>
          <span>Coordinates unavailable for this route set.</span>
        </div>
        <div className="map-empty">Search results are listed below.</div>
      </div>
    );
  }

  return (
    <div className="map-panel">
      <div className="map-heading">
        <h3>Map</h3>
        <div className="map-legend">
          <span>
            <i className="focus-dot" /> {mode === "outbound" ? "Origin" : "Arrival"}
          </span>
          <span>
            <i className="available-dot" /> {mode === "outbound" ? "Destinations" : "Origins"}
          </span>
        </div>
      </div>
      <svg className="route-map" role="img" viewBox="0 0 760 420" aria-label="Available cities map">
        <rect width="760" height="420" rx="8" />
        <path className="france-shape" d={outlinePath(FRANCE_OUTLINE)} />
        <path className="france-shape corsica-shape" d={outlinePath(CORSICA_OUTLINE)} />
        {numberMapPoints(points).map((point) => {
          const position = projectPoint(point);
          const radius = point.kind === "focus" ? 10 : 11;
          const canJump = point.kind === "available";

          return (
            <g
              className={point.kind === "focus" ? "map-point focus-map-point" : "map-point"}
              key={`${point.kind}:${point.place}`}
              onClick={canJump ? () => scrollToPlace(point.place) : undefined}
              onKeyDown={(event) => {
                if (canJump && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  scrollToPlace(point.place);
                }
              }}
              role={canJump ? "button" : undefined}
              tabIndex={canJump ? 0 : undefined}
              transform={`translate(${position.x} ${position.y})`}
            >
              <circle className={mapPointClass(point)} r={radius} />
              <text className="marker-label" dy="4">{point.marker}</text>
            </g>
          );
        })}
      </svg>
      <MapIndex points={numberMapPoints(points)} />
    </div>
  );
}

function groupTrains(trains: TrainAvailability[], mode: SearchMode): GroupedResults {
  const days = new Map<string, Map<string, TrainAvailability[]>>();

  for (const train of trains) {
    const place = mode === "outbound" ? train.destination : train.origin;
    if (!days.has(train.date)) {
      days.set(train.date, new Map());
    }

    const places = days.get(train.date);
    if (!places?.has(place)) {
      places?.set(place, []);
    }

    places?.get(place)?.push(train);
  }

  return Array.from(days, ([date, places]) => ({
    date,
    places: Array.from(places, ([place, groupedTrains]) => ({
      place,
      trains: groupedTrains
    }))
  }));
}

function buildMapPoints(trains: TrainAvailability[], station: string, mode: SearchMode) {
  const focusName = findFocusName(trains, station, mode);
  const focusCoords = resolveStationCoords(focusName);
  if (!focusCoords) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const train of trains) {
    const name = mode === "outbound" ? train.destination : train.origin;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const points: MapPoint[] = [
    {
      name: shortStationName(focusName),
      place: focusName,
      ...focusCoords,
      kind: "focus",
      count: trains.length
    }
  ];

  for (const [name, count] of counts) {
    const coords = resolveStationCoords(name);
    if (coords) {
      points.push({
        name: shortStationName(name),
        place: name,
        ...coords,
        kind: "available",
        count
      });
    }
  }

  return points;
}

function buildRouteMapPoints(route: RouteOption): RouteMapPoint[] {
  const names = [route.legs[0]?.origin, ...route.legs.map((leg) => leg.destination)].filter(
    (name): name is string => Boolean(name)
  );
  const uniqueNames = names.filter((name, index) => names.findIndex((item) => sameMapCity(item, name)) === index);

  return uniqueNames
    .map((name, index) => {
      const coords = resolveStationCoords(name);
      if (!coords) {
        return null;
      }

      return {
        name: shortStationName(name),
        place: name,
        ...coords,
        kind: index === 0 ? "focus" : "available",
        count: 1,
        order: index
      };
    })
    .filter((point): point is RouteMapPoint => Boolean(point));
}

function buildReachableMapPoints(routes: RouteOption[], station: string, mode: SearchMode): MapPoint[] {
  const focusName =
    mode === "inbound"
      ? routes[0]?.legs[routes[0].legs.length - 1]?.destination || station
      : routes[0]?.legs[0]?.origin || station;
  const focusCoords = resolveStationCoords(focusName);
  if (!focusCoords) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const route of routes) {
    const place =
      mode === "inbound"
        ? route.legs[0]?.origin
        : route.legs[route.legs.length - 1]?.destination;
    if (place) {
      if (mode !== "inbound" && route.legs.length === 1) {
        counts.set(place, (counts.get(place) ?? 0) + 1);
      } else if (mode === "inbound" && route.legs.length === 1) {
        counts.set(place, (counts.get(place) ?? 0) + 1);
      } else {
        counts.set(place, Math.min(counts.get(place) ?? route.legs.length, route.legs.length));
      }
    }
  }

  const points: MapPoint[] = [
    {
      name: shortStationName(focusName),
      place: focusName,
      ...focusCoords,
      kind: "focus",
      count: routes.length
    }
  ];

  for (const [place, count] of counts) {
    const coords = resolveStationCoords(place);
    if (coords) {
      points.push({
        name: shortStationName(place),
        place,
        ...coords,
        kind:
          routes[0]?.legs.length === 1
            ? "one-leg"
            : count === 2
              ? "two-leg"
              : "three-leg",
        count
      });
    }
  }

  return points;
}

function bestRoutesByCity(routes: RouteOption[], mode: SearchMode) {
  const best = new Map<string, RouteOption>();

  for (const route of routes) {
    const city =
      mode === "inbound"
        ? route.legs[0]?.origin
        : route.legs[route.legs.length - 1]?.destination;
    if (!city) {
      continue;
    }

    const key = shortStationName(city);
    const current = best.get(key);
    if (!current || compareRoutePreference(route, current) < 0) {
      best.set(key, route);
    }
  }

  return Array.from(best.values()).sort((a, b) => {
    const cityA = mode === "inbound" ? a.legs[0]?.origin : a.legs[a.legs.length - 1]?.destination;
    const cityB = mode === "inbound" ? b.legs[0]?.origin : b.legs[b.legs.length - 1]?.destination;
    return shortStationName(cityA ?? "").localeCompare(shortStationName(cityB ?? ""), "fr");
  });
}

function sortReachableRoutes(routes: RouteOption[], mode: SearchMode) {
  return routes.slice().sort((a, b) => {
    const cityA = mode === "inbound" ? a.legs[0]?.origin : a.legs[a.legs.length - 1]?.destination;
    const cityB = mode === "inbound" ? b.legs[0]?.origin : b.legs[b.legs.length - 1]?.destination;
    return (
      shortStationName(cityA ?? "").localeCompare(shortStationName(cityB ?? ""), "fr") ||
      compareRoutePreference(a, b)
    );
  });
}

function compareRoutePreference(a: RouteOption, b: RouteOption) {
  return (
    a.legs.length - b.legs.length ||
    a.durationMinutes - b.durationMinutes ||
    routeDepartureMinutes(a) - routeDepartureMinutes(b)
  );
}

function numberMapPoints<T extends MapPoint>(points: T[]): Array<LabeledPoint<T>> {
  let marker = 1;

  return points.map((point) => ({
    ...point,
    marker: point.kind === "focus" ? "" : String(marker++)
  }));
}

function routeDepartureMinutes(route: RouteOption) {
  const [hours = "0", minutes = "0"] = route.legs[0]?.departureTime.split(":") ?? [];
  return Number(hours) * 60 + Number(minutes);
}

function groupReachableRoutes(routes: RouteOption[], mode: SearchMode): ReachableCityGroup[] {
  const groups = new Map<string, RouteOption[]>();

  for (const route of routes) {
    const city =
      mode === "inbound"
        ? route.legs[0]?.origin
        : route.legs[route.legs.length - 1]?.destination;
    if (!city) {
      continue;
    }

    const label = shortStationName(city);
    groups.set(label, [...(groups.get(label) ?? []), route]);
  }

  return Array.from(groups, ([city, groupRoutes]) => ({
    city,
    routes: groupRoutes.sort((a, b) => a.legs.length - b.legs.length || a.durationMinutes - b.durationMinutes)
  })).sort((a, b) => a.city.localeCompare(b.city, "fr"));
}

function mapPointClass(point: MapPoint) {
  if (point.kind === "focus") {
    return "focus-point";
  }

  if (point.kind === "one-leg") {
    return "one-leg-point";
  }

  if (point.kind === "two-leg") {
    return "two-leg-point";
  }

  if (point.kind === "three-leg") {
    return "three-leg-point";
  }

  return "available-point";
}

function sameMapCity(a: string, b: string) {
  return stationCityKey(a) === stationCityKey(b);
}

function findFocusName(trains: TrainAvailability[], station: string, mode: SearchMode) {
  const first = trains[0];
  if (!first) {
    return station;
  }

  return mode === "outbound" ? first.origin : first.destination;
}

function resolveStationCoords(name: string) {
  const key = stationCityKey(name);
  return CITY_COORDS[key];
}

function stationCityKey(name: string) {
  const normalized = stripAccents(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/ST /g, "SAINT ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const exactOrPrefix = Object.keys(CITY_COORDS)
    .sort((a, b) => b.length - a.length)
    .find((city) => normalized === city || normalized.startsWith(`${city} `));

  return exactOrPrefix ?? (normalized.split(" ")[0] ?? "");
}

function shortStationName(name: string) {
  return name.replace(/\s*\([^)]*\)/g, "").trim();
}

function stripAccents(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

function outlinePath(points: Array<[number, number]>) {
  return points
    .map(([lon, lat], index) => {
      const point = projectGeo(lon, lat);
      return `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    })
    .join(" ");
}

function projectPoint(point: MapPoint) {
  return projectGeo(point.lon, point.lat);
}

function projectGeo(lon: number, lat: number) {
  const width = 700;
  const height = 360;
  const left = 30;
  const top = 30;
  const lonRange = MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon;
  const latRange = MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat;

  return {
    x: left + ((lon - MAP_BOUNDS.minLon) / lonRange) * width,
    y: top + ((MAP_BOUNDS.maxLat - lat) / latRange) * height
  };
}

function scrollToPlace(place: string) {
  document.getElementById(placeAnchorId(place))?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function scrollToReachable(place: string) {
  document.getElementById(reachableAnchorId(shortStationName(place)))?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function getFirstPlaceDates(groupedResults: GroupedResults) {
  const dates = new Map<string, string>();

  for (const day of groupedResults) {
    for (const place of day.places) {
      if (!dates.has(place.place)) {
        dates.set(place.place, day.date);
      }
    }
  }

  return dates;
}

function placeAnchorId(place: string) {
  return `place-${stripAccents(place)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function reachableAnchorId(place: string) {
  return `reachable-${stripAccents(place)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function countDayTrains(day: GroupedResults[number]) {
  return day.places.reduce((sum, place) => sum + place.trains.length, 0);
}

async function loadRouteSuggestions(
  value: string,
  field: "origin" | "destination",
  setter: (suggestions: string[]) => void
) {
  if (value.trim().length < 2) {
    setter([]);
    return;
  }

  const endpoint = field === "origin" ? "/api/origins" : "/api/destinations";

  try {
    const response = await fetch(`${endpoint}?q=${encodeURIComponent(value)}`);
    const data = (await response.json()) as SuggestionsResponse;

    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load station suggestions.");
    }

    setter(field === "origin" ? (data.origins ?? []) : (data.destinations ?? []));
  } catch {
    setter([]);
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!hours) {
    return `${rest}m`;
  }

  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function todayInputValue() {
  return formatInputDate(new Date());
}

function addDaysInput(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatInputDate(value);
}

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
