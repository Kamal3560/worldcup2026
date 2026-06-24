const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + "/api/live-cache");
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  const provider = (env.FOOTBALL_PROVIDER || "mock").toLowerCase();
  let payload;
  if (provider === "espn" || provider === "mock") {
    payload = await fromEspn();
  } else if (provider === "api-football" && env.API_FOOTBALL_KEY) {
    payload = await fromApiFootball(env);
  } else if (provider === "football-data" && env.FOOTBALL_DATA_TOKEN) {
    payload = await fromFootballData(env);
  } else {
    payload = await fromEspn();
  }

  const response = json(payload, 200, {
    "Cache-Control": `public, max-age=${Number(env.LIVE_CACHE_SECONDS || 55)}`,
  });
  await cache.put(cacheKey, response.clone());
  return response;
}

async function fromEspn() {
  const today = new Date();
  const dates = [-1, 0, 1].map((offset) => formatEspnDate(addDays(today, offset)));
  const results = await Promise.all(
    dates.map(async (date) => {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date}`, {
        headers: { "User-Agent": "worldcup2026-prediction-pool/1.0" },
      });
      if (!response.ok) return [];
      const body = await response.json();
      return body.events || [];
    }),
  );

  const seen = new Set();
  const matches = [];
  for (const event of results.flat()) {
    if (!event?.id || seen.has(event.id)) continue;
    seen.add(event.id);
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];
    const home = competitors.find((item) => item.homeAway === "home");
    const away = competitors.find((item) => item.homeAway === "away");
    if (!home || !away) continue;
    const status = normalizeEspnStatus(competition?.status || event.status);
    matches.push({
      providerId: event.id,
      id: event.id,
      home: home.team?.displayName || home.team?.shortDisplayName || home.team?.name,
      away: away.team?.displayName || away.team?.shortDisplayName || away.team?.name,
      score: [Number(home.score || 0), Number(away.score || 0)],
      status,
      minute: competition?.status?.displayClock || event.status?.displayClock || null,
      date: event.date || competition?.date || null,
    });
  }

  return {
    provider: "espn",
    updatedAt: new Date().toISOString(),
    matches,
  };
}

function addDays(date, offset) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + offset);
  return copy;
}

function formatEspnDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function fromApiFootball(env) {
  const league = env.API_FOOTBALL_LEAGUE || "1";
  const season = env.API_FOOTBALL_SEASON || "2026";
  const url = `https://v3.football.api-sports.io/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}&live=all`;
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || `API-Football failed: ${response.status}`);
  return {
    provider: "api-football",
    updatedAt: new Date().toISOString(),
    matches: (body.response || []).map((item) => ({
      providerId: item.fixture?.id,
      id: String(item.fixture?.id),
      home: item.teams?.home?.name,
      away: item.teams?.away?.name,
      score: [item.goals?.home ?? 0, item.goals?.away ?? 0],
      status: normalizeStatus(item.fixture?.status?.short),
      minute: item.fixture?.status?.elapsed,
    })),
  };
}

async function fromFootballData(env) {
  const competition = env.FOOTBALL_DATA_COMPETITION || "WC";
  const url = `https://api.football-data.org/v4/competitions/${encodeURIComponent(competition)}/matches`;
  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": env.FOOTBALL_DATA_TOKEN,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || `football-data failed: ${response.status}`);
  return {
    provider: "football-data",
    updatedAt: new Date().toISOString(),
    matches: (body.matches || [])
      .filter((item) => ["IN_PLAY", "PAUSED", "FINISHED"].includes(item.status))
      .map((item) => ({
        providerId: item.id,
        id: String(item.id),
        home: item.homeTeam?.name,
        away: item.awayTeam?.name,
        score: [item.score?.fullTime?.home ?? item.score?.regularTime?.home ?? 0, item.score?.fullTime?.away ?? item.score?.regularTime?.away ?? 0],
        status: normalizeStatus(item.status),
        minute: item.minute || null,
      })),
  };
}

function mockPayload() {
  return {
    provider: "mock",
    updatedAt: new Date().toISOString(),
    error: "No live provider configured. Add Cloudflare environment variables to enable automatic scores.",
    matches: [],
  };
}

function normalizeStatus(status) {
  const value = String(status || "").toUpperCase();
  if (["1H", "2H", "ET", "P", "LIVE", "IN_PLAY"].includes(value)) return "LIVE";
  if (["HT", "PAUSED", "BT"].includes(value)) return "HALFTIME";
  if (["FT", "AET", "PEN", "FINISHED"].includes(value)) return "FINAL";
  return value || "SCHEDULED";
}

function normalizeEspnStatus(status) {
  const type = status?.type || {};
  const state = String(type.state || "").toLowerCase();
  const name = String(type.name || "").toUpperCase();
  const detail = String(type.shortDetail || type.detail || "").toUpperCase();
  if (type.completed || state === "post" || name.includes("FULL_TIME") || detail === "FT") return "FINAL";
  if (state === "in" || name.includes("IN_PROGRESS") || detail.includes("'")) return "LIVE";
  if (detail.includes("HT") || name.includes("HALF")) return "HALFTIME";
  return "SCHEDULED";
}

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extraHeaders,
    },
  });
}
