"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RandomTripOption, RouteOption, TrainAvailability } from "@/lib/sncf";

type SearchMode = "outbound" | "inbound" | "route" | "flexible" | "random";
type Status = "idle" | "loading" | "success" | "empty" | "error";
type Language = "en" | "pt" | "fr" | "es";

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

type RandomTripResponse = {
  trip: RandomTripOption | null;
  checkedAt: string;
  error?: string;
};

type RandomCityMode = "fixed" | "surprise";

type FlexibleRouteEvent =
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
    }
  | {
      type: "error";
      error: string;
    };

type FlexibleSearchState = {
  isSearching: boolean;
  message: string;
  currentCheck: string;
  foundCount: number;
  searchedFrom: string;
  searchedTo: string;
  totalTrains: number;
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

const LANGUAGES: Array<{ code: Language; label: string }> = [
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" }
];

const COPY: Record<Language, Record<string, string>> = {
  en: {
    brandSubtitle: "Available MAX JEUNE and MAX SENIOR seats from SNCF Open Data.",
    refresh: "Refresh SNCF data",
    refreshing: "Refreshing...",
    language: "Language",
    fromTab: "From",
    toTab: "To",
    routeTab: "Route",
    flexibleTab: "Flexible",
    randomTab: "Random",
    outboundTitle: "Find free MAX trains from your station.",
    inboundTitle: "Find free MAX trains arriving at your station.",
    routeTitle: "Go from one city to another on one date.",
    flexibleTitle: "Brute-force a flexible MAX route.",
    randomTitle: "Generate a surprise round trip.",
    outboundIntro: "Pick an origin and see every available destination.",
    inboundIntro: "Pick an arrival city and see every available departure city.",
    routeIntro: "Search direct trains and same-day connections for the exact date you choose.",
    flexibleIntro: "Pick what you can accept, then the app scans forward from your date and stops on the first departure day with good routes.",
    randomIntro: "Choose a start, an end, and how much surprise you want. The app builds a loop that comes back home.",
    originStation: "Origin station",
    arrivalStation: "Arrival station",
    origin: "Origin",
    destination: "Destination",
    swapRoute: "Swap origin and destination",
    travelDate: "Travel date",
    startSearchingFrom: "Start searching from",
    searchTrains: "Search trains",
    searching: "Searching...",
    findRoute: "Find route",
    startBruteForce: "Start brute force",
    numberOfTrains: "Number of trains",
    tripCanLast: "Trip can last",
    flexibleWarning: "This is a brute-force search. It can take a while, but it stops when it finds the first departure day with routes and only shows the best arrivals for that day.",
    nightOnly: "Night Intercites only",
    map: "Map",
    ready: "Ready to search.",
    lastChecked: "Last checked",
    rollingWindow: "Rolling SNCF availability window: 30 days.",
    bookingNotice: "This availability helper is not a booking service. Always confirm the seat on SNCF Connect before planning your trip.",
    startOutbound: "Start with an origin station.",
    startInbound: "Start with an arrival station.",
    startRoute: "Start with an origin, destination, and date.",
    startFlexible: "Start with a route and the limits you can accept.",
    suggestionHint: "Try official names or city-wide options such as PARIS (all stations).",
    loadingSncf: "Searching SNCF availability...",
    loadingSncfDetail: "Checking the current MAX dataset for matching trains.",
    noAvailable: "No available MAX trains found.",
    routeEmpty: "No route was found with up to {count} legs on the selected date.",
    flexibleEmpty: "The brute-force scan finished without finding a route inside the selected limits.",
    reachableEmpty: "No reachable city was found with up to 3 legs for this date.",
    trainEmpty: "SNCF Open Data has no available MAX seats for this search.",
    routeFlexibleHint: " Try the Flexible tab if you want the app to search later days and longer paths.",
    dataError: "SNCF data could not be loaded.",
    retryRefresh: "Please retry or refresh the SNCF data.",
    flexibleRunning: "Brute-force search running...",
    flexibleFinished: "Brute-force search finished.",
    waitingScan: "Waiting for the scan to start.",
    preparingWindow: "Preparing the SNCF availability window...",
    dailyScan: "Starting the daily brute-force scan.",
    searchComplete: "Search complete.",
    searchStopped: "Search stopped.",
    stop: "Stop",
    routesFound: "{count} route{plural} found",
    trainsLoaded: "{count} trains loaded",
    foundStopping: "Found {count} option{plural}. Stopping on this departure day.",
    directTrain: "Direct train",
    connectionFound: "Connection found",
    bruteRoute: "{count} day brute-force route",
    legLabel: "{count} leg{plural}",
    includingWaiting: ", including {duration} waiting",
    toWord: "to",
    trainWord: "Train",
    randomStart: "Leave after",
    randomEnd: "Be back before",
    citiesToVisit: "Cities to visit",
    fixedCities: "Choose city count",
    surpriseCities: "Completely random",
    generateRandom: "Generate trip",
    randomTip: "Prefers direct trains, morning departures, different cities, long stays, and an evening return.",
    randomEmpty: "No round trip was found in this window. Try a longer window or fewer cities.",
    randomTrip: "Random trip",
    backHome: "Back home",
    stay: "{duration} to explore",
    totalStay: "{duration} exploring",
    totalTravel: "{duration} on trains"
  },
  pt: {
    brandSubtitle: "Assentos MAX JEUNE e MAX SENIOR disponíveis nos dados abertos da SNCF.",
    refresh: "Atualizar dados SNCF",
    refreshing: "Atualizando...",
    language: "Idioma",
    fromTab: "De",
    toTab: "Para",
    routeTab: "Rota",
    flexibleTab: "Flexível",
    randomTab: "Aleatória",
    outboundTitle: "Encontre trens MAX grátis saindo da sua estação.",
    inboundTitle: "Encontre trens MAX grátis chegando à sua estação.",
    routeTitle: "Vá de uma cidade a outra em uma data.",
    flexibleTitle: "Force uma busca flexível de rota MAX.",
    randomTitle: "Gere uma ida e volta surpresa.",
    outboundIntro: "Escolha uma origem e veja todos os destinos disponíveis.",
    inboundIntro: "Escolha uma chegada e veja todas as cidades de partida disponíveis.",
    routeIntro: "Busca trens diretos e conexões no mesmo dia para a data exata escolhida.",
    flexibleIntro: "Escolha o que você aceita, então o app varre a partir da data e para no primeiro dia de partida com boas rotas.",
    randomIntro: "Escolha início, fim e quanta surpresa quer. O app monta um circuito que volta para casa.",
    originStation: "Estação de origem",
    arrivalStation: "Estação de chegada",
    origin: "Origem",
    destination: "Destino",
    swapRoute: "Inverter origem e destino",
    travelDate: "Data da viagem",
    startSearchingFrom: "Começar a buscar em",
    searchTrains: "Buscar trens",
    searching: "Buscando...",
    findRoute: "Buscar rota",
    startBruteForce: "Iniciar força bruta",
    numberOfTrains: "Quantidade de trens",
    tripCanLast: "Viagem pode durar",
    flexibleWarning: "Esta é uma busca por força bruta. Pode demorar, mas ela para quando encontra o primeiro dia de partida com rotas e mostra apenas as melhores chegadas daquele dia.",
    nightOnly: "Apenas Intercités noturnos",
    map: "Mapa",
    ready: "Pronto para buscar.",
    lastChecked: "Última checagem",
    rollingWindow: "Janela de disponibilidade SNCF: 30 dias.",
    bookingNotice: "Este helper de disponibilidade não é um serviço de reserva. Sempre confirme o assento na SNCF Connect antes de planejar a viagem.",
    startOutbound: "Comece com uma estação de origem.",
    startInbound: "Comece com uma estação de chegada.",
    startRoute: "Comece com origem, destino e data.",
    startFlexible: "Comece com uma rota e os limites que você aceita.",
    suggestionHint: "Tente nomes oficiais ou opções por cidade, como PARIS (all stations).",
    loadingSncf: "Buscando disponibilidade SNCF...",
    loadingSncfDetail: "Checando o dataset MAX atual para trens compatíveis.",
    noAvailable: "Nenhum trem MAX disponível encontrado.",
    routeEmpty: "Nenhuma rota foi encontrada com até {count} trechos na data selecionada.",
    flexibleEmpty: "A busca por força bruta terminou sem encontrar rota dentro dos limites escolhidos.",
    reachableEmpty: "Nenhuma cidade alcançável foi encontrada com até 3 trechos nessa data.",
    trainEmpty: "Os dados abertos da SNCF não têm assentos MAX disponíveis para esta busca.",
    routeFlexibleHint: " Tente a aba Flexível para buscar em dias posteriores e caminhos mais longos.",
    dataError: "Os dados da SNCF não puderam ser carregados.",
    retryRefresh: "Tente novamente ou atualize os dados da SNCF.",
    flexibleRunning: "Busca por força bruta em andamento...",
    flexibleFinished: "Busca por força bruta finalizada.",
    waitingScan: "Aguardando o início da varredura.",
    preparingWindow: "Preparando a janela de disponibilidade da SNCF...",
    dailyScan: "Iniciando a busca por força bruta dia a dia.",
    searchComplete: "Busca finalizada.",
    searchStopped: "Busca interrompida.",
    stop: "Parar",
    routesFound: "{count} rota{plural} encontrada{plural}",
    trainsLoaded: "{count} trens carregados",
    foundStopping: "Encontrada{plural} {count} opção{plural}. Parando neste dia de partida.",
    directTrain: "Trem direto",
    connectionFound: "Conexão encontrada",
    bruteRoute: "Rota por força bruta de {count} dia{plural}",
    legLabel: "{count} trecho{plural}",
    includingWaiting: ", incluindo {duration} de espera",
    toWord: "até",
    trainWord: "Trem",
    randomStart: "Sair depois de",
    randomEnd: "Voltar antes de",
    citiesToVisit: "Cidades para conhecer",
    fixedCities: "Escolher quantidade",
    surpriseCities: "Completamente aleatório",
    generateRandom: "Gerar viagem",
    randomTip: "Prioriza trens diretos, saídas de manhã, cidades diferentes, longas estadias e volta à noite.",
    randomEmpty: "Nenhuma ida e volta foi encontrada nessa janela. Tente uma janela maior ou menos cidades.",
    randomTrip: "Viagem aleatória",
    backHome: "Volta para casa",
    stay: "{duration} para explorar",
    totalStay: "{duration} explorando",
    totalTravel: "{duration} em trens"
  },
  fr: {
    brandSubtitle: "Places MAX JEUNE et MAX SENIOR disponibles depuis les données ouvertes SNCF.",
    refresh: "Actualiser les données SNCF",
    refreshing: "Actualisation...",
    language: "Langue",
    fromTab: "Départ",
    toTab: "Arrivée",
    routeTab: "Trajet",
    flexibleTab: "Flexible",
    randomTab: "Aléatoire",
    outboundTitle: "Trouvez des trains MAX gratuits depuis votre gare.",
    inboundTitle: "Trouvez des trains MAX gratuits vers votre gare.",
    routeTitle: "Aller d'une ville à une autre à une date.",
    flexibleTitle: "Chercher un trajet MAX flexible en force brute.",
    randomTitle: "Générer un aller-retour surprise.",
    outboundIntro: "Choisissez un départ et voyez toutes les destinations disponibles.",
    inboundIntro: "Choisissez une arrivée et voyez toutes les villes de départ disponibles.",
    routeIntro: "Recherche les trains directs et les correspondances le même jour pour la date choisie.",
    flexibleIntro: "Choisissez ce que vous acceptez, puis l'app cherche à partir de votre date et s'arrête au premier jour de départ avec de bons trajets.",
    randomIntro: "Choisissez le début, la fin et le niveau de surprise. L'app construit une boucle qui revient au point de départ.",
    originStation: "Gare de départ",
    arrivalStation: "Gare d'arrivée",
    origin: "Départ",
    destination: "Destination",
    swapRoute: "Inverser départ et destination",
    travelDate: "Date du voyage",
    startSearchingFrom: "Chercher à partir du",
    searchTrains: "Chercher des trains",
    searching: "Recherche...",
    findRoute: "Chercher le trajet",
    startBruteForce: "Lancer la force brute",
    numberOfTrains: "Nombre de trains",
    tripCanLast: "Le voyage peut durer",
    flexibleWarning: "C'est une recherche en force brute. Elle peut prendre du temps, mais elle s'arrête dès qu'elle trouve le premier jour de départ avec des trajets et n'affiche que les meilleures arrivées.",
    nightOnly: "Intercités de nuit uniquement",
    map: "Carte",
    ready: "Prêt à chercher.",
    lastChecked: "Dernière vérification",
    rollingWindow: "Fenêtre de disponibilité SNCF : 30 jours.",
    bookingNotice: "Cet outil de disponibilité n'est pas un service de réservation. Confirmez toujours la place sur SNCF Connect avant de planifier votre voyage.",
    startOutbound: "Commencez par une gare de départ.",
    startInbound: "Commencez par une gare d'arrivée.",
    startRoute: "Commencez avec un départ, une destination et une date.",
    startFlexible: "Commencez avec un trajet et les limites acceptées.",
    suggestionHint: "Essayez les noms officiels ou les options par ville comme PARIS (all stations).",
    loadingSncf: "Recherche des disponibilités SNCF...",
    loadingSncfDetail: "Vérification du jeu de données MAX actuel.",
    noAvailable: "Aucun train MAX disponible trouvé.",
    routeEmpty: "Aucun trajet trouvé avec jusqu'à {count} segments à la date choisie.",
    flexibleEmpty: "La recherche en force brute s'est terminée sans trajet dans les limites choisies.",
    reachableEmpty: "Aucune ville accessible trouvée avec jusqu'à 3 segments pour cette date.",
    trainEmpty: "Les données ouvertes SNCF n'ont aucun siège MAX disponible pour cette recherche.",
    routeFlexibleHint: " Essayez l'onglet Flexible pour chercher des jours plus tard et des trajets plus longs.",
    dataError: "Les données SNCF n'ont pas pu être chargées.",
    retryRefresh: "Réessayez ou actualisez les données SNCF.",
    flexibleRunning: "Recherche en force brute en cours...",
    flexibleFinished: "Recherche en force brute terminée.",
    waitingScan: "En attente du démarrage de la recherche.",
    preparingWindow: "Préparation de la fenêtre de disponibilité SNCF...",
    dailyScan: "Démarrage de la recherche jour par jour.",
    searchComplete: "Recherche terminée.",
    searchStopped: "Recherche arrêtée.",
    stop: "Arrêter",
    routesFound: "{count} trajet{plural} trouvé{plural}",
    trainsLoaded: "{count} trains chargés",
    foundStopping: "{count} option{plural} trouvée{plural}. Arrêt sur ce jour de départ.",
    directTrain: "Train direct",
    connectionFound: "Correspondance trouvée",
    bruteRoute: "Trajet en force brute de {count} jour{plural}",
    legLabel: "{count} segment{plural}",
    includingWaiting: ", dont {duration} d'attente",
    toWord: "à",
    trainWord: "Train",
    randomStart: "Partir après",
    randomEnd: "Revenir avant",
    citiesToVisit: "Villes à visiter",
    fixedCities: "Choisir le nombre",
    surpriseCities: "Complètement aléatoire",
    generateRandom: "Générer le voyage",
    randomTip: "Privilégie les trains directs, les départs le matin, les villes différentes, les longs arrêts et un retour le soir.",
    randomEmpty: "Aucun aller-retour trouvé dans cette fenêtre. Essayez une fenêtre plus longue ou moins de villes.",
    randomTrip: "Voyage aléatoire",
    backHome: "Retour",
    stay: "{duration} pour explorer",
    totalStay: "{duration} sur place",
    totalTravel: "{duration} en train"
  },
  es: {
    brandSubtitle: "Asientos MAX JEUNE y MAX SENIOR disponibles desde datos abiertos de SNCF.",
    refresh: "Actualizar datos SNCF",
    refreshing: "Actualizando...",
    language: "Idioma",
    fromTab: "Desde",
    toTab: "Hasta",
    routeTab: "Ruta",
    flexibleTab: "Flexible",
    randomTab: "Aleatoria",
    outboundTitle: "Encuentra trenes MAX gratis desde tu estación.",
    inboundTitle: "Encuentra trenes MAX gratis hacia tu estación.",
    routeTitle: "Ir de una ciudad a otra en una fecha.",
    flexibleTitle: "Buscar una ruta MAX flexible por fuerza bruta.",
    randomTitle: "Genera una ida y vuelta sorpresa.",
    outboundIntro: "Elige un origen y mira todos los destinos disponibles.",
    inboundIntro: "Elige una llegada y mira todas las ciudades de salida disponibles.",
    routeIntro: "Busca trenes directos y conexiones del mismo día para la fecha exacta elegida.",
    flexibleIntro: "Elige lo que aceptas, luego la app busca desde tu fecha y se detiene en el primer día de salida con buenas rutas.",
    randomIntro: "Elige inicio, fin y cuánta sorpresa quieres. La app arma un circuito que vuelve a casa.",
    originStation: "Estación de origen",
    arrivalStation: "Estación de llegada",
    origin: "Origen",
    destination: "Destino",
    swapRoute: "Invertir origen y destino",
    travelDate: "Fecha de viaje",
    startSearchingFrom: "Buscar desde",
    searchTrains: "Buscar trenes",
    searching: "Buscando...",
    findRoute: "Buscar ruta",
    startBruteForce: "Iniciar fuerza bruta",
    numberOfTrains: "Cantidad de trenes",
    tripCanLast: "El viaje puede durar",
    flexibleWarning: "Esta es una búsqueda por fuerza bruta. Puede tardar, pero se detiene cuando encuentra el primer día de salida con rutas y solo muestra las mejores llegadas de ese día.",
    nightOnly: "Solo Intercités nocturnos",
    map: "Mapa",
    ready: "Listo para buscar.",
    lastChecked: "Última revisión",
    rollingWindow: "Ventana de disponibilidad SNCF: 30 días.",
    bookingNotice: "Este ayudante de disponibilidad no es un servicio de reserva. Confirma siempre el asiento en SNCF Connect antes de planificar tu viaje.",
    startOutbound: "Empieza con una estación de origen.",
    startInbound: "Empieza con una estación de llegada.",
    startRoute: "Empieza con origen, destino y fecha.",
    startFlexible: "Empieza con una ruta y los límites que aceptas.",
    suggestionHint: "Prueba nombres oficiales u opciones por ciudad como PARIS (all stations).",
    loadingSncf: "Buscando disponibilidad SNCF...",
    loadingSncfDetail: "Revisando el dataset MAX actual.",
    noAvailable: "No se encontraron trenes MAX disponibles.",
    routeEmpty: "No se encontró ruta con hasta {count} tramos en la fecha elegida.",
    flexibleEmpty: "La búsqueda por fuerza bruta terminó sin encontrar ruta dentro de los límites elegidos.",
    reachableEmpty: "No se encontró ninguna ciudad alcanzable con hasta 3 tramos para esta fecha.",
    trainEmpty: "Los datos abiertos de SNCF no tienen asientos MAX disponibles para esta búsqueda.",
    routeFlexibleHint: " Prueba la pestaña Flexible para buscar días posteriores y caminos más largos.",
    dataError: "No se pudieron cargar los datos SNCF.",
    retryRefresh: "Intenta de nuevo o actualiza los datos SNCF.",
    flexibleRunning: "Búsqueda por fuerza bruta en curso...",
    flexibleFinished: "Búsqueda por fuerza bruta finalizada.",
    waitingScan: "Esperando el inicio de la búsqueda.",
    preparingWindow: "Preparando la ventana de disponibilidad SNCF...",
    dailyScan: "Iniciando la búsqueda diaria por fuerza bruta.",
    searchComplete: "Búsqueda finalizada.",
    searchStopped: "Búsqueda detenida.",
    stop: "Detener",
    routesFound: "{count} ruta{plural} encontrada{plural}",
    trainsLoaded: "{count} trenes cargados",
    foundStopping: "{count} opción{plural} encontrada{plural}. Deteniendo en este día de salida.",
    directTrain: "Tren directo",
    connectionFound: "Conexión encontrada",
    bruteRoute: "Ruta por fuerza bruta de {count} día{plural}",
    legLabel: "{count} tramo{plural}",
    includingWaiting: ", incluyendo {duration} de espera",
    toWord: "a",
    trainWord: "Tren",
    randomStart: "Salir después de",
    randomEnd: "Volver antes de",
    citiesToVisit: "Ciudades para conocer",
    fixedCities: "Elegir cantidad",
    surpriseCities: "Completamente aleatorio",
    generateRandom: "Generar viaje",
    randomTip: "Prioriza trenes directos, salidas por la mañana, ciudades distintas, estancias largas y regreso por la noche.",
    randomEmpty: "No se encontró una ida y vuelta en esta ventana. Prueba una ventana más larga o menos ciudades.",
    randomTrip: "Viaje aleatorio",
    backHome: "Vuelta a casa",
    stay: "{duration} para explorar",
    totalStay: "{duration} explorando",
    totalTravel: "{duration} en trenes"
  }
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
  "SAINT BRIEUC": { lat: 48.5142, lon: -2.7658 },
  "SAINT MALO": { lat: 48.6493, lon: -2.0257 },
  "SAINT NAZAIRE": { lat: 47.2735, lon: -2.2138 },
  "SAINT PIERRE DES CORPS": { lat: 47.3862, lon: 0.7233 },
  "SAINT RAPHAEL": { lat: 43.4233, lon: 6.7684 },
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
  const [language, setLanguage] = useState<Language>("en");
  const [mode, setMode] = useState<SearchMode>("outbound");
  const [station, setStation] = useState("");
  const [date, setDate] = useState("");
  const [nightOnly, setNightOnly] = useState(false);
  const [reachableLegs, setReachableLegs] = useState(1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [trains, setTrains] = useState<TrainAvailability[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [randomTrip, setRandomTrip] = useState<RandomTripOption | null>(null);
  const [randomTripHistory, setRandomTripHistory] = useState<string[]>([]);
  const [randomCityHistory, setRandomCityHistory] = useState<string[]>([]);
  const [routeOrigin, setRouteOrigin] = useState("");
  const [routeDestination, setRouteDestination] = useState("");
  const [routeDate, setRouteDate] = useState("");
  const [routeMaxLegs, setRouteMaxLegs] = useState(2);
  const [randomStartAt, setRandomStartAt] = useState("");
  const [randomEndAt, setRandomEndAt] = useState("");
  const [randomCityCount, setRandomCityCount] = useState(3);
  const [randomCityMode, setRandomCityMode] = useState<RandomCityMode>("fixed");
  const [flexLegCounts, setFlexLegCounts] = useState<number[]>([1, 2, 3]);
  const [flexTravelDays, setFlexTravelDays] = useState<number[]>([1, 2, 3]);
  const [flexState, setFlexState] = useState<FlexibleSearchState>({
    isSearching: false,
    message: "",
    currentCheck: "",
    foundCount: 0,
    searchedFrom: "",
    searchedTo: "",
    totalTrains: 0
  });
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [routeOriginSuggestions, setRouteOriginSuggestions] = useState<string[]>([]);
  const [routeDestinationSuggestions, setRouteDestinationSuggestions] = useState<string[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const flexAbortRef = useRef<AbortController | null>(null);
  const text = COPY[language];
  const randomMaxCities = useMemo(
    () => maxRandomCitiesForWindow(randomStartAt, randomEndAt),
    [randomEndAt, randomStartAt]
  );

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("tgvmax-language");
    setLanguage(resolveLanguage(savedLanguage || window.navigator.language));
  }, []);

  useEffect(() => {
    const today = todayInputValue();
    setDate(today);
    setRouteDate(today);
    setRandomStartAt(`${today}T08:00`);
    setRandomEndAt(`${addDaysInput(today, 3)}T22:00`);
  }, []);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    window.localStorage.setItem("tgvmax-language", nextLanguage);
  }

  function swapRouteEndpoints() {
    setRouteOrigin(routeDestination);
    setRouteDestination(routeOrigin);
    setRouteOriginSuggestions([]);
    setRouteDestinationSuggestions([]);
    setRoutes([]);
    setSelectedRouteId("");
    setStatus("idle");
    setError("");
  }

  useEffect(() => {
    flexAbortRef.current?.abort();
    flexAbortRef.current = null;
    setSuggestions([]);
    setTrains([]);
    setRoutes([]);
    setRandomTrip(null);
    setRandomTripHistory([]);
    setRandomCityHistory([]);
    setReachableLegs(1);
    setStatus("idle");
    setError("");
    setRouteMaxLegs(2);
    setFlexState((current) => ({
      ...current,
      isSearching: false,
      message: "",
      currentCheck: "",
      foundCount: 0
    }));
  }, [mode]);

  useEffect(() => {
    return () => {
      flexAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setRandomCityCount((current) => Math.min(Math.max(1, current), randomMaxCities));
  }, [randomMaxCities]);

  useEffect(() => {
    setRandomTripHistory([]);
    setRandomCityHistory([]);
  }, [randomCityCount, randomCityMode, randomEndAt, randomStartAt, routeOrigin]);

  useEffect(() => {
    if (isPlannerMode(mode) || station.trim().length < 2) {
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
    if (!isPlannerMode(mode)) {
      return;
    }

    loadRouteSuggestions(routeOrigin, "origin", setRouteOriginSuggestions);
  }, [mode, routeOrigin]);

  useEffect(() => {
    if (mode === "random" || !isPlannerMode(mode)) {
      return;
    }

    loadRouteSuggestions(routeDestination, "destination", setRouteDestinationSuggestions);
  }, [mode, routeDestination]);

  const groupedResults = useMemo(() => groupTrains(trains, mode), [mode, trains]);
  const mapPoints = useMemo(() => buildMapPoints(trains, station, mode), [mode, station, trains]);
  const displayRoutes = useMemo(
    () => (mode === "flexible" ? sortFlexibleRoutes(routes) : routes),
    [mode, routes]
  );
  const selectedRoute = useMemo(
    () => displayRoutes.find((route) => route.id === selectedRouteId) ?? displayRoutes[0],
    [displayRoutes, selectedRouteId]
  );
  const firstPlaceDates = useMemo(() => getFirstPlaceDates(groupedResults), [groupedResults]);

  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!station.trim()) {
      setError(mode === "outbound" ? text.startOutbound : text.startInbound);
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
      setError(text.startRoute);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");
    setRoutes([]);

    const params = new URLSearchParams({
      origin: routeOrigin.trim(),
      destination: routeDestination.trim(),
      mode: "specific",
      maxLegs: String(nextMaxLegs)
    });

    params.set("date", routeDate);

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

  async function searchFlexible(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!routeOrigin.trim() || !routeDestination.trim()) {
      setError(text.startRoute);
      setStatus("error");
      return;
    }

    if (!flexLegCounts.length || !flexTravelDays.length) {
      setError(text.startFlexible);
      setStatus("error");
      return;
    }

    flexAbortRef.current?.abort();
    const controller = new AbortController();
    flexAbortRef.current = controller;

    setStatus("loading");
    setError("");
    setRoutes([]);
    setSelectedRouteId("");
    setFlexState({
      isSearching: true,
      message: text.preparingWindow,
      currentCheck: flexibleCheckLabel(routeDate, flexTravelDays[0] ?? 1, flexLegCounts[0] ?? 1, language),
      foundCount: 0,
      searchedFrom: routeDate,
      searchedTo: "",
      totalTrains: 0
    });

    const params = new URLSearchParams({
      origin: routeOrigin.trim(),
      destination: routeDestination.trim(),
      startDate: routeDate,
      legCounts: flexLegCounts.join(","),
      travelDays: flexTravelDays.join(",")
    });

    try {
      const response = await fetch(`/api/flexible-routes?${params}`, {
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Flexible routes could not be searched.");
      }

      await readFlexibleStream(response.body, (eventData) => {
        if (eventData.type === "meta") {
          setCheckedAt(eventData.checkedAt);
          setFlexState((current) => ({
            ...current,
            searchedFrom: eventData.searchedFrom,
            searchedTo: eventData.searchedTo,
            totalTrains: eventData.totalTrains,
            message: text.dailyScan
          }));
          return;
        }

        if (eventData.type === "progress") {
          const progressMessage =
            eventData.travelDays && eventData.legCount
              ? text.dailyScan
              : eventData.foundCount > 0
                ? formatTemplate(text.foundStopping, {
                    count: String(eventData.foundCount),
                    plural: eventData.foundCount === 1 ? "" : "s"
                  })
                : text.loadingSncfDetail;
          setFlexState((current) => ({
            ...current,
            message: progressMessage,
            currentCheck:
              eventData.travelDays && eventData.legCount
                ? flexibleCheckLabel(eventData.date, eventData.travelDays, eventData.legCount, language)
                : current.currentCheck,
            foundCount: eventData.foundCount,
            totalTrains: eventData.totalTrains ?? current.totalTrains
          }));
          return;
        }

        if (eventData.type === "route") {
          setRoutes((current) => mergeRoute(current, eventData.route));
          setSelectedRouteId((current) => current || eventData.route.id);
          setStatus("success");
          setFlexState((current) => ({
            ...current,
            foundCount: eventData.foundCount,
            message: formatTemplate(text.foundStopping, {
              count: String(eventData.foundCount),
              plural: eventData.foundCount === 1 ? "" : "s"
            })
          }));
          return;
        }

        if (eventData.type === "error") {
          throw new Error(eventData.error);
        }
      });

      setFlexState((current) => ({ ...current, isSearching: false, message: text.searchComplete }));
      setStatus((current) => (current === "success" ? "success" : "empty"));
    } catch (requestError) {
      if (controller.signal.aborted) {
        setFlexState((current) => ({ ...current, isSearching: false, message: text.searchStopped }));
        setStatus((current) => (current === "success" ? "success" : "idle"));
        return;
      }

      setRoutes([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Flexible routes could not be searched."
      );
      setFlexState((current) => ({ ...current, isSearching: false }));
      setStatus("error");
    } finally {
      if (flexAbortRef.current === controller) {
        flexAbortRef.current = null;
      }
    }
  }

function stopFlexibleSearch() {
    flexAbortRef.current?.abort();
  }

  async function searchRandom(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!routeOrigin.trim()) {
      setError(text.startOutbound);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");
    setRandomTrip(null);

    const params = new URLSearchParams({
      origin: routeOrigin.trim(),
      startAt: randomStartAt,
      endAt: randomEndAt,
      cityCount: String(Math.min(randomCityCount, randomMaxCities)),
      randomCityCount: String(randomCityMode === "surprise"),
      nonce: `${Date.now()}-${Math.random()}`
    });
    randomTripHistory.forEach((tripId) => {
      params.append("excludeTripId", tripId);
    });
    randomCityHistory.forEach((city) => {
      params.append("excludeCity", city);
    });

    try {
      const response = await fetch(`/api/random-route?${params}`);
      const data = await readJsonResponse<RandomTripResponse>(
        response,
        "Random trip could not be generated."
      );

      const generatedTrip = data.trip;
      setRandomTrip(generatedTrip);
      if (generatedTrip) {
        setRandomTripHistory((current) => Array.from(new Set([...current, generatedTrip.id])));
        setRandomCityHistory((current) =>
          Array.from(new Set([...current, ...generatedTrip.stops.map((stop) => stop.city || stop.arrivalLeg.destination)]))
        );
      }
      setCheckedAt(data.checkedAt);
      setStatus(data.trip ? "success" : "empty");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Random trip could not be generated."
      );
      setStatus("error");
    }
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
              <p>{text.brandSubtitle}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <label className="language-picker">
              <span aria-hidden="true">Aa</span>
              <select
                aria-label={text.language}
                onChange={(event) => changeLanguage(event.target.value as Language)}
                value={language}
              >
                {LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="refresh-button" disabled={refreshing} onClick={refresh} type="button">
              {refreshing ? text.refreshing : text.refresh}
            </button>
          </div>
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
              {text.fromTab}
            </button>
            <button
              aria-selected={mode === "inbound"}
              className={mode === "inbound" ? "tab active" : "tab"}
              onClick={() => setMode("inbound")}
              role="tab"
              type="button"
            >
              {text.toTab}
            </button>
            <button
              aria-selected={mode === "route"}
              className={mode === "route" ? "tab active" : "tab"}
              onClick={() => setMode("route")}
              role="tab"
              type="button"
            >
              {text.routeTab}
            </button>
            <button
              aria-selected={mode === "flexible"}
              className={mode === "flexible" ? "tab active" : "tab"}
              onClick={() => setMode("flexible")}
              role="tab"
              type="button"
            >
              {text.flexibleTab}
            </button>
            <button
              aria-selected={mode === "random"}
              className={mode === "random" ? "tab active" : "tab"}
              onClick={() => setMode("random")}
              role="tab"
              type="button"
            >
              {text.randomTab}
            </button>
          </div>

          <div className="intro">
            <h2 id="search-title">
              {mode === "outbound"
                ? text.outboundTitle
                : mode === "inbound"
                  ? text.inboundTitle
                  : mode === "route"
                    ? text.routeTitle
                    : mode === "flexible"
                      ? text.flexibleTitle
                      : text.randomTitle}
            </h2>
            <p>
              {mode === "outbound"
                ? text.outboundIntro
                : mode === "inbound"
                  ? text.inboundIntro
                  : mode === "route"
                    ? text.routeIntro
                    : mode === "flexible"
                      ? text.flexibleIntro
                      : text.randomIntro}
            </p>
          </div>

          {!isPlannerMode(mode) ? (
          <form className="search-form" onSubmit={search}>
            <div className="field">
              <label htmlFor="station">
                {mode === "outbound" ? text.originStation : text.arrivalStation}
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
              <label htmlFor="date">{text.travelDate}</label>
              <input
                id="date"
                onChange={(event) => setDate(event.target.value)}
                type="date"
                value={date}
              />
            </div>

            <button className="primary-button" disabled={status === "loading"} type="submit">
              {status === "loading" ? text.searching : text.searchTrains}
            </button>
          </form>
          ) : mode === "route" ? (
            <form className="route-form route-form-simple" onSubmit={(event) => searchRoute(event, 2)}>
              <StationInput
                id="route-origin"
                label={text.origin}
                onChange={setRouteOrigin}
                onPick={(value) => {
                  setRouteOrigin(value);
                  setRouteOriginSuggestions([]);
                }}
                placeholder="Paris..."
                suggestions={routeOriginSuggestions}
                value={routeOrigin}
              />
              <button
                aria-label={text.swapRoute}
                className="swap-route-button"
                onClick={swapRouteEndpoints}
                title={text.swapRoute}
                type="button"
              >
                {"\u21c4"}
              </button>
              <StationInput
                id="route-destination"
                label={text.destination}
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
                <label htmlFor="route-date">{text.travelDate}</label>
                <input
                  id="route-date"
                  onChange={(event) => setRouteDate(event.target.value)}
                  type="date"
                  value={routeDate}
                />
              </div>
              <button
                className="primary-button"
                disabled={status === "loading"}
                type="submit"
              >
                {status === "loading" ? text.searching : text.findRoute}
              </button>
            </form>
          ) : mode === "flexible" ? (
            <form className="flexible-form" onSubmit={searchFlexible}>
              <StationInput
                id="flex-origin"
                label={text.origin}
                onChange={setRouteOrigin}
                onPick={(value) => {
                  setRouteOrigin(value);
                  setRouteOriginSuggestions([]);
                }}
                placeholder="Paris..."
                suggestions={routeOriginSuggestions}
                value={routeOrigin}
              />
              <button
                aria-label={text.swapRoute}
                className="swap-route-button"
                onClick={swapRouteEndpoints}
                title={text.swapRoute}
                type="button"
              >
                {"\u21c4"}
              </button>
              <StationInput
                id="flex-destination"
                label={text.destination}
                onChange={setRouteDestination}
                onPick={(value) => {
                  setRouteDestination(value);
                  setRouteDestinationSuggestions([]);
                }}
                placeholder="Nice..."
                suggestions={routeDestinationSuggestions}
                value={routeDestination}
              />
              <div className="field">
                <label htmlFor="flex-date">{text.startSearchingFrom}</label>
                <input
                  id="flex-date"
                  onChange={(event) => setRouteDate(event.target.value)}
                  type="date"
                  value={routeDate}
                />
              </div>
              <button
                className="primary-button"
                disabled={flexState.isSearching}
                type="submit"
              >
                {flexState.isSearching ? text.searching : text.startBruteForce}
              </button>

              <div className="choice-panel" aria-label="Flexible route limits">
                <div className="choice-set">
                  <span>{text.numberOfTrains}</span>
                  {[1, 2, 3, 4].map((count) => (
                    <label className={flexLegCounts.includes(count) ? "active" : ""} key={count}>
                      <input
                        checked={flexLegCounts.includes(count)}
                        onChange={() => setFlexLegCounts((current) => toggleNumber(current, count))}
                        type="checkbox"
                      />
                      {count}
                    </label>
                  ))}
                </div>
                <div className="choice-set">
                  <span>{text.tripCanLast}</span>
                  {[1, 2, 3].map((days) => (
                    <label className={flexTravelDays.includes(days) ? "active" : ""} key={days}>
                      <input
                        checked={flexTravelDays.includes(days)}
                        onChange={() => setFlexTravelDays((current) => toggleNumber(current, days))}
                        type="checkbox"
                      />
                      {formatDayLabel(days, language)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="warning-card">
                {text.flexibleWarning}
              </div>
            </form>
          ) : (
            <form className="random-form" onSubmit={searchRandom}>
              <StationInput
                id="random-origin"
                label={text.origin}
                onChange={setRouteOrigin}
                onPick={(value) => {
                  setRouteOrigin(value);
                  setRouteOriginSuggestions([]);
                }}
                placeholder="Paris..."
                suggestions={routeOriginSuggestions}
                value={routeOrigin}
              />
              <div className="field">
                <label htmlFor="random-start">{text.randomStart}</label>
                <input
                  id="random-start"
                  onChange={(event) => setRandomStartAt(event.target.value)}
                  type="datetime-local"
                  value={randomStartAt}
                />
              </div>
              <div className="field">
                <label htmlFor="random-end">{text.randomEnd}</label>
                <input
                  id="random-end"
                  onChange={(event) => setRandomEndAt(event.target.value)}
                  type="datetime-local"
                  value={randomEndAt}
                />
              </div>
              <div className="choice-panel random-choice-panel">
                <div className="choice-set">
                  <span>{text.citiesToVisit}</span>
                  <label className={randomCityMode === "fixed" ? "active" : ""}>
                    <input
                      checked={randomCityMode === "fixed"}
                      onChange={() => setRandomCityMode("fixed")}
                      type="checkbox"
                    />
                    {text.fixedCities}
                  </label>
                  <label className={randomCityMode === "surprise" ? "active" : ""}>
                    <input
                      checked={randomCityMode === "surprise"}
                      onChange={() => setRandomCityMode("surprise")}
                      type="checkbox"
                    />
                    {text.surpriseCities}
                  </label>
                </div>
                {randomCityMode === "fixed" ? (
                  <div className="field random-count-field">
                    <label htmlFor="random-city-count">
                      {text.citiesToVisit} (max {randomMaxCities})
                    </label>
                    <input
                      aria-label={text.citiesToVisit}
                      id="random-city-count"
                      className="small-number-input"
                      max={randomMaxCities}
                      min={1}
                      onChange={(event) =>
                        setRandomCityCount(Math.min(randomMaxCities, Math.max(1, Number(event.target.value))))
                      }
                      type="number"
                      value={randomCityCount}
                    />
                  </div>
                ) : null}
                <button className="primary-button" disabled={status === "loading"} type="submit">
                  {status === "loading" ? text.searching : text.generateRandom}
                </button>
                <div className="warning-card random-tip">{text.randomTip}</div>
              </div>
            </form>
          )}

          {!isPlannerMode(mode) ? (
            <label className="check-row">
              <input
                checked={nightOnly}
                onChange={(event) => setNightOnly(event.target.checked)}
                type="checkbox"
              />
              {text.nightOnly}
            </label>
          ) : null}

          {!isPlannerMode(mode) ? (
            <div className="leg-filter" aria-label="Reachable train count">
              <span>{text.map}</span>
              {[1, 2, 3].map((legCount) => (
                <label className={reachableLegs === legCount ? "active" : ""} key={legCount}>
                  <input
                    checked={reachableLegs === legCount}
                    onChange={() => setReachableLegs(legCount)}
                    name="reachable-legs"
                    type="radio"
                  />
                  {formatTrainLabel(legCount, language)}
                </label>
              ))}
            </div>
          ) : null}

          <div className="meta-row">
            <span>
              {checkedAt ? `${text.lastChecked}: ${formatCheckedAt(checkedAt, language)}` : text.ready}
            </span>
            <span>{text.rollingWindow}</span>
          </div>
        </section>

        <p className="notice">
          {text.bookingNotice}
        </p>

        <section className="results" aria-live="polite">
          {status === "idle" ? (
            <div className="message">
              <strong>
                {mode === "outbound"
                  ? text.startOutbound
                  : mode === "inbound"
                    ? text.startInbound
                    : mode === "route"
                      ? text.startRoute
                      : mode === "flexible"
                        ? text.startFlexible
                        : text.randomTip}
              </strong>
              {text.suggestionHint}
            </div>
          ) : null}

          {status === "loading" && mode !== "flexible" ? (
            <div className="message">
              <strong>{text.loadingSncf}</strong>
              {text.loadingSncfDetail}
            </div>
          ) : null}

          {mode === "flexible" && (flexState.isSearching || flexState.message) ? (
            <FlexibleProgress
              language={language}
              onStop={stopFlexibleSearch}
              state={flexState}
              text={text}
            />
          ) : null}

          {status === "empty" ? (
            <div className="message">
              <strong>{text.noAvailable}</strong>
              {mode === "route"
                ? formatTemplate(text.routeEmpty, { count: String(routeMaxLegs) })
                : mode === "flexible"
                  ? text.flexibleEmpty
                : mode === "random"
                  ? text.randomEmpty
                : reachableLegs
                  ? text.reachableEmpty
                : text.trainEmpty}
              {mode === "route" ? (
                <span>{text.routeFlexibleHint}</span>
              ) : null}
            </div>
          ) : null}

          {status === "error" ? (
            <div className="message">
              <strong>{text.dataError}</strong>
              {error || text.retryRefresh}
            </div>
          ) : null}

          {status === "success" && !isPlannerMode(mode) && !reachableLegs ? (
            <AvailabilityMap points={mapPoints} mode={mode} />
          ) : null}

          {status === "success" && !isPlannerMode(mode) && reachableLegs ? (
            <ReachableMap routes={routes} mode={mode} station={station} />
          ) : null}

          {status === "success" && mode === "random" && randomTrip ? (
            <>
              <RandomTripMap trip={randomTrip} />
              <RandomTripResult language={language} text={text} trip={randomTrip} />
            </>
          ) : null}

          {(status === "success" || (mode === "flexible" && routes.length > 0)) &&
          isRouteSearchMode(mode) &&
          selectedRoute ? (
            <RouteMap route={selectedRoute} />
          ) : null}

          {(status === "success" || (mode === "flexible" && routes.length > 0)) &&
          (isRouteSearchMode(mode) || reachableLegs) ? (
            reachableLegs && !isPlannerMode(mode) ? (
              <ReachableResults
                language={language}
                mode={mode}
                onSelect={setSelectedRouteId}
                routes={routes}
                selectedRouteId={selectedRoute?.id ?? ""}
                text={text}
              />
            ) : (
              <RouteResults
                language={language}
                onSelect={setSelectedRouteId}
                routes={displayRoutes}
                selectedRouteId={selectedRoute?.id ?? ""}
                text={text}
                variant={mode === "flexible" ? "flexible" : "default"}
              />
            )
          ) : null}

          {status === "success" && !isPlannerMode(mode) && !reachableLegs
            ? groupedResults.map((day) => (
                <div className="day-group" key={day.date}>
                  <div className="day-heading">
                    <h3>{formatDate(day.date, language)}</h3>
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
  function pickSuggestion(suggestion: string) {
    onPick(suggestion);
  }

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
            <button
              key={suggestion}
              onClick={() => pickSuggestion(suggestion)}
              onPointerDown={(event) => {
                event.preventDefault();
                pickSuggestion(suggestion);
              }}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RouteResults({
  language,
  onSelect,
  routes,
  selectedRouteId,
  text,
  variant = "default"
}: {
  language: Language;
  onSelect: (routeId: string) => void;
  routes: RouteOption[];
  selectedRouteId: string;
  text: Record<string, string>;
  variant?: "default" | "flexible";
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
              <strong>
                {route.type === "direct"
                  ? text.directTrain
                  : variant === "flexible"
                    ? formatTemplate(text.bruteRoute, {
                        count: String(routeTravelDays(route)),
                        plural: routeTravelDays(route) === 1 ? "" : "s"
                      })
                    : text.connectionFound}
              </strong>
              <span>
                {formatDuration(route.durationMinutes)}
                {route.waitMinutes
                  ? formatTemplate(text.includingWaiting, { duration: formatDuration(route.waitMinutes) })
                  : ""}
              </span>
            </div>
            <span className="badge">
              {formatTemplate(text.legLabel, {
                count: String(route.legs.length),
                plural: route.legs.length === 1 ? "" : "s"
              })}
            </span>
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
                    {formatDate(leg.date, language)} · {leg.departureTime} {text.toWord} {leg.arrivalTime} · {text.trainWord}{" "}
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

function FlexibleProgress({
  language,
  onStop,
  state,
  text
}: {
  language: Language;
  onStop: () => void;
  state: FlexibleSearchState;
  text: Record<string, string>;
}) {
  return (
    <div className="search-progress">
      <div className={state.isSearching ? "progress-orbit" : "progress-orbit stopped"} aria-hidden="true" />
      <div>
        <strong>{state.isSearching ? text.flexibleRunning : text.flexibleFinished}</strong>
        <span className="current-check">
          {state.currentCheck || state.message || text.waitingScan}
        </span>
        {state.currentCheck && state.message ? <small>{state.message}</small> : null}
        <div className="progress-facts">
          <em>
            {formatTemplate(text.routesFound, {
              count: String(state.foundCount),
              plural: state.foundCount === 1 ? "" : "s"
            })}
          </em>
          {state.totalTrains ? (
            <em>{formatTemplate(text.trainsLoaded, { count: String(state.totalTrains) })}</em>
          ) : null}
          {state.searchedTo ? <em>{state.searchedFrom} to {state.searchedTo}</em> : null}
        </div>
      </div>
      {state.isSearching ? (
        <button onClick={onStop} type="button">
          {text.stop}
        </button>
      ) : null}
    </div>
  );
}

function RandomTripResult({
  language,
  text,
  trip
}: {
  language: Language;
  text: Record<string, string>;
  trip: RandomTripOption;
}) {
  return (
    <div className="route-results">
      <article className="route-option selected random-trip-card">
        <header>
          <div>
            <strong>{text.randomTrip}</strong>
            <span>
              {trip.stops.length} {text.citiesToVisit.toLowerCase()} ·{" "}
              {formatTemplate(text.totalStay, { duration: formatDuration(trip.totalStayMinutes) })} ·{" "}
              {formatTemplate(text.totalTravel, { duration: formatDuration(trip.totalTravelMinutes) })}
            </span>
          </div>
          <span className="badge">{trip.origin}</span>
        </header>
        <div className="route-legs">
          {trip.stops.map((stop, index) => (
            <div className="route-leg" key={`${stop.arrivalLeg.id}:${index}`}>
              <span className="leg-index">{index + 1}</span>
              <div>
                <strong>
                  {stop.arrivalLeg.origin} {"->"} {stop.arrivalLeg.destination}
                </strong>
                <span>
                  {formatDate(stop.arrivalLeg.date, language)} · {stop.arrivalLeg.departureTime}{" "}
                  {text.toWord} {stop.arrivalLeg.arrivalTime} · {text.trainWord} {stop.arrivalLeg.trainNo}
                </span>
                <em>{formatTemplate(text.stay, { duration: formatDuration(stop.stayMinutes) })}</em>
              </div>
            </div>
          ))}
          <div className="route-leg">
            <span className="leg-index">{trip.stops.length + 1}</span>
            <div>
              <strong>
                {text.backHome}: {trip.returnLeg.origin} {"->"} {trip.returnLeg.destination}
              </strong>
              <span>
                {formatDate(trip.returnLeg.date, language)} · {trip.returnLeg.departureTime} {text.toWord}{" "}
                {trip.returnLeg.arrivalTime} · {text.trainWord} {trip.returnLeg.trainNo}
              </span>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

function ReachableResults({
  language,
  mode,
  onSelect,
  routes,
  selectedRouteId,
  text
}: {
  language: Language;
  mode: SearchMode;
  onSelect: (routeId: string) => void;
  routes: RouteOption[];
  selectedRouteId: string;
  text: Record<string, string>;
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
            language={language}
            onSelect={onSelect}
            routes={group.routes}
            selectedRouteId={selectedRouteId}
            text={text}
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
              <title>{point.name}</title>
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

function RandomTripMap({ trip }: { trip: RandomTripOption }) {
  const points = buildRandomTripMapPoints(trip);
  if (points.length < 2) {
    return (
      <div className="map-panel">
        <div className="map-heading">
          <h3>Route map</h3>
          <span>Coordinates unavailable for this trip.</span>
        </div>
        <div className="map-empty">Trip details are listed below.</div>
      </div>
    );
  }

  const loopPoints = [...points, points[0]];

  return (
    <div className="map-panel">
      <div className="map-heading">
        <h3>Route map</h3>
        <span>{trip.stops.length} cities, returning to {shortStationName(trip.origin)}</span>
      </div>
      <svg className="route-map" role="img" viewBox="0 0 760 420" aria-label="Random trip map">
        <rect width="760" height="420" rx="8" />
        <path className="france-shape" d={outlinePath(FRANCE_OUTLINE)} />
        <path className="france-shape corsica-shape" d={outlinePath(CORSICA_OUTLINE)} />
        <polyline
          className="selected-route-line"
          points={loopPoints
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
              <title>{point.name}</title>
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
              <title>{point.name}</title>
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
              <title>{point.name}</title>
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

function buildRandomTripMapPoints(trip: RandomTripOption): RouteMapPoint[] {
  const names = [
    trip.origin,
    ...trip.stops.map((stop) => stop.arrivalLeg.destination)
  ].filter((name): name is string => Boolean(name));
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

  if (exactOrPrefix) {
    return exactOrPrefix;
  }

  const words = normalized.split(" ").filter(Boolean);
  if (words[0] === "SAINT" && words[1]) {
    let end = 2;
    const linkWords = new Set(["DE", "DES", "DU", "EN", "SUR", "SOUS", "LE", "LA", "LES"]);

    while (end < words.length && linkWords.has(words[end])) {
      end = Math.min(words.length, end + 2);
    }

    return words.slice(0, end).join(" ");
  }

  return words[0] ?? "";
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

function isRouteSearchMode(mode: SearchMode) {
  return mode === "route" || mode === "flexible";
}

function isPlannerMode(mode: SearchMode) {
  return mode === "route" || mode === "flexible" || mode === "random";
}

function toggleNumber(values: number[], value: number) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value].sort((a, b) => a - b);
}

function maxRandomCitiesForWindow(startAt: string, endAt: string) {
  if (!startAt || !endAt) {
    return 1;
  }

  const startDate = Date.parse(`${startAt.slice(0, 10)}T00:00:00`);
  const endDate = Date.parse(`${endAt.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(startDate) || Number.isNaN(endDate) || endDate < startDate) {
    return 1;
  }

  const daySpan = Math.floor((endDate - startDate) / 86_400_000);
  return Math.max(1, daySpan + 1);
}

function resolveLanguage(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("pt")) {
    return "pt";
  }
  if (normalized.startsWith("fr")) {
    return "fr";
  }
  if (normalized.startsWith("es")) {
    return "es";
  }
  return "en";
}

function formatTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template
  );
}

function flexibleCheckLabel(date: string, travelDays: number, legCount: number, language: Language) {
  const separator = language === "en" ? "on" : language === "fr" ? "le" : "dia";
  return `${formatDayLabel(travelDays, language)}, ${formatTrainLabel(legCount, language)}, ${separator} ${date}`;
}

function formatDayLabel(days: number, language: Language) {
  if (language === "en") {
    return `${days} day${days > 1 ? "s" : ""}`;
  }
  if (language === "fr") {
    return `${days} jour${days > 1 ? "s" : ""}`;
  }
  if (language === "es") {
    return `${days} día${days > 1 ? "s" : ""}`;
  }
  return `${days} dia${days > 1 ? "s" : ""}`;
}

function formatTrainLabel(count: number, language: Language) {
  if (language === "en") {
    return `${count} train${count > 1 ? "s" : ""}`;
  }
  if (language === "fr") {
    return `${count} train${count > 1 ? "s" : ""}`;
  }
  if (language === "es") {
    return `${count} tren${count > 1 ? "es" : ""}`;
  }
  return `${count} trem${count > 1 ? "s" : ""}`;
}

function mergeRoute(routes: RouteOption[], route: RouteOption) {
  if (routes.some((current) => current.id === route.id)) {
    return routes;
  }

  return sortFlexibleRoutes([...routes, route]);
}

async function readFlexibleStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventData: FlexibleRouteEvent) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        onEvent(JSON.parse(line) as FlexibleRouteEvent);
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as FlexibleRouteEvent);
  }
}

function sortFlexibleRoutes(routes: RouteOption[]) {
  return routes.slice().sort((a, b) => {
    return (
      routeArrivalValue(a) - routeArrivalValue(b) ||
      routeTravelDays(a) - routeTravelDays(b) ||
      a.legs.length - b.legs.length ||
      a.durationMinutes - b.durationMinutes ||
      routeDepartureValue(a) - routeDepartureValue(b)
    );
  });
}

function routeArrivalValue(route: RouteOption) {
  const lastLeg = route.legs[route.legs.length - 1];
  return dateIndexInput(route.arrivalDate) * 1440 + timeToMinutes(lastLeg?.arrivalTime ?? "00:00");
}

function routeDepartureValue(route: RouteOption) {
  const firstLeg = route.legs[0];
  return (
    dateIndexInput(firstLeg?.date ?? route.departureDate) * 1440 +
    timeToMinutes(firstLeg?.departureTime ?? "00:00")
  );
}

function routeTravelDays(route: RouteOption) {
  return Math.max(1, dateIndexInput(route.arrivalDate) - dateIndexInput(route.departureDate) + 1);
}

function dateIndexInput(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function timeToMinutes(time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
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

async function readJsonResponse<T extends { error?: string }>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    await response.text().catch(() => "");
    const status = response.status ? ` (${response.status})` : "";
    throw new Error(`${fallbackMessage}${status}`);
  }

  const data = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(data.error ?? fallbackMessage);
  }

  return data;
}

function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(languageLocale(language), {
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

function formatCheckedAt(value: string, language: Language) {
  return new Intl.DateTimeFormat(languageLocale(language), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function languageLocale(language: Language) {
  if (language === "pt") {
    return "pt-BR";
  }
  if (language === "fr") {
    return "fr-FR";
  }
  if (language === "es") {
    return "es-ES";
  }
  return "en-US";
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
