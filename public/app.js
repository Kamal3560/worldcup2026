const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  live: { matches: [], updatedAt: null, provider: "none", error: null },
  settings: {},
  timer: null,
};

const outcome = ([home, away]) => (home > away ? "H" : home < away ? "A" : "D");
const TEAM_ALIASES = {
  czechia: "czech republic",
  "south korea": "korea republic",
  "usa": "united states",
  "usmnt": "united states",
  "iran": "i r iran",
  "ir iran": "i r iran",
  "cote d ivoire": "ivory coast",
  "côte d ivoire": "ivory coast",
  curacao: "curacao",
  curaçao: "curacao",
  "bosnia herzegovina": "bosnia and herzegovina",
};
const money = (value) => {
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0));
  return `${formatted}${state.settings.moneySuffix || ""}`;
};

async function boot() {
  state.data = await fetchJson("./data/predictions.json");
  state.settings = {
    moneyLabel: state.data.settings?.moneyLabel || "Prize",
    moneySuffix: state.data.settings?.moneySuffix || "",
    refreshSeconds: state.data.settings?.refreshSeconds || 60,
    stagePrizes: state.data.settings?.stagePrizes || {},
  };
  localStorage.removeItem("wcSettings");
  localStorage.removeItem("wcManualScores");
  $("appTitle").textContent = state.data.settings?.title || "2026 World Cup Prediction Pool";
  fillStaticControls();
  bindEvents();
  await refreshLive();
  render();
  scheduleRefresh();
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json();
}

function fillStaticControls() {
  const stages = ["all", ...new Set(state.data.matches.map((match) => match.stage))];
  $("stageFilter").innerHTML = stages.map((stage) => `<option value="${escapeAttr(stage)}">${stage === "all" ? "All stages" : escapeHtml(stage)}</option>`).join("");
  $("participantSelect").innerHTML = state.data.participants.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      $(tab.dataset.view).classList.add("active");
    });
  });
  ["searchInput", "stageFilter", "statusFilter", "participantSelect"].forEach((id) => $(id).addEventListener("input", render));
  $("refreshBtn").addEventListener("click", async () => {
    await refreshLive();
    render();
  });
}

function scheduleRefresh() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(async () => {
    await refreshLive();
    render();
  }, Math.max(15, state.settings.refreshSeconds || 60) * 1000);
}

async function refreshLive() {
  try {
    const result = await fetchJson("./api/live");
    state.live = {
      provider: result.provider || "live-api",
      updatedAt: result.updatedAt || new Date().toISOString(),
      matches: result.matches || [],
      error: result.error || null,
    };
  } catch (error) {
    state.live = {
      provider: "offline",
      updatedAt: new Date().toISOString(),
      matches: [],
      error: "Live scores are not connected in this preview. Using workbook scores.",
    };
  }
}

function activeScore(match) {
  const live = state.live.matches.find((item) => sameMatch(item, match));
  if (live?.score && hasUsableLiveScore(live.status)) {
    return { score: live.score, status: live.status || "LIVE", minute: live.minute || null, source: state.live.provider };
  }

  if (match.seedScore) {
    return { score: match.seedScore, status: "FINAL", minute: null, source: "workbook" };
  }
  return { score: null, status: "SCHEDULED", minute: null, source: "schedule" };
}

function hasUsableLiveScore(status) {
  return ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "FINAL", "FINISHED", "FT"].includes(String(status || "").toUpperCase());
}

function scoreMatch(match) {
  const active = activeScore(match);
  const prize = Number(match.prizePerMatch || 0);
  const base = {
    match,
    ...active,
    exactWinners: [],
    outcomeWinners: [],
    winners: [],
    winnerType: "none",
    prizePerWinner: 0,
    rollover: 0,
    isLive: ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME"].includes(String(active.status).toUpperCase()),
    isFinal: ["FINAL", "FINISHED", "FT"].includes(String(active.status).toUpperCase()),
  };
  if (!active.score) return base;

  const resultOutcome = outcome(active.score);
  for (const participant of state.data.participants) {
    const guess = match.predictions?.[participant];
    if (!guess) continue;
    if (guess[0] === active.score[0] && guess[1] === active.score[1]) {
      base.exactWinners.push(participant);
    } else if (outcome(guess) === resultOutcome) {
      base.outcomeWinners.push(participant);
    }
  }
  base.winners = base.exactWinners.length ? base.exactWinners : base.outcomeWinners;
  base.winnerType = base.exactWinners.length ? "exact" : base.outcomeWinners.length ? "outcome" : "rollover";
  base.prizePerWinner = base.winners.length ? prize / base.winners.length : 0;
  base.rollover = base.winners.length ? 0 : prize;
  return base;
}

function sameMatch(live, match) {
  if (String(live.id) === String(match.id)) return true;
  const liveHome = normalizeName(live.home);
  const liveAway = normalizeName(live.away);
  const home = normalizeName(match.home);
  const away = normalizeName(match.away);
  return liveHome && liveAway && ((liveHome === home && liveAway === away) || (liveHome === away && liveAway === home));
}

function normalizeName(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return TEAM_ALIASES[normalized] || normalized;
}

function calculate() {
  const rows = state.data.participants.map((name) => ({
    name,
    confirmed: 0,
    live: 0,
    total: 0,
    exact: 0,
    outcome: 0,
    wins: 0,
  }));
  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
  const matchResults = state.data.matches.map(scoreMatch);
  let rollover = 0;
  let confirmedMatches = 0;
  let liveMatches = 0;

  for (const result of matchResults) {
    if (result.score && result.isFinal) confirmedMatches += 1;
    if (result.score && result.isLive) liveMatches += 1;
    rollover += result.rollover;
    for (const winner of result.winners) {
      const row = byName[winner];
      const amount = result.prizePerWinner;
      row.total += amount;
      row.wins += 1;
      if (result.winnerType === "exact") row.exact += 1;
      if (result.winnerType === "outcome") row.outcome += 1;
      if (result.isLive) row.live += amount;
      else row.confirmed += amount;
    }
  }

  rows.sort((a, b) => b.total - a.total || b.exact - a.exact || b.wins - a.wins || a.name.localeCompare(b.name));
  return { leaderboard: rows, matchResults, rollover, confirmedMatches, liveMatches };
}

function render() {
  if (!state.data) return;
  const model = calculate();
  renderStatus(model);
  renderOverview(model);
  renderLeaderboard(model);
  renderMatches(model);
  renderParticipant(model);
  renderPredictionTrends(model);
}

function renderStatus(model) {
  const pieces = [];
  if (state.live.error) pieces.push(state.live.error);
  pieces.push(`Automatic scores: ${state.live.provider}`);
  pieces.push(`${model.confirmedMatches} final matches`);
  pieces.push(`${model.liveMatches} live now`);
  pieces.push(`${state.data.participants.length} players`);
  $("feedStatus").textContent = pieces.join(" | ");
  renderPrizeSummary();
}

function renderOverview(model) {
  const leader = model.leaderboard[0];
  $("kpiLeader").textContent = leader ? `${leader.name} (${money(leader.total)})` : "-";
  $("kpiConfirmed").textContent = model.confirmedMatches;
  $("kpiLive").textContent = model.liveMatches;
  $("kpiRollover").textContent = money(model.rollover);
  $("updatedAt").textContent = `Updated ${formatTime(state.live.updatedAt)}`;

  renderResultBoard(model);

  $("topLeaders").innerHTML = model.leaderboard.slice(0, 6).map((row, index) => leaderRow(row, index)).join("");
  $("recentWinners").innerHTML = model.matchResults
    .filter((item) => item.score)
    .slice(-6)
    .reverse()
    .map(matchCard)
    .join("");
  renderUpcoming(model);
}

function renderPrizeSummary() {
  const stagePrizes = Object.entries(state.settings.stagePrizes || {});
  const matchStages = new Set((state.data?.matches || []).map((match) => match.stage));
  $("prizeSummary").innerHTML = stagePrizes.length
    ? stagePrizes
        .filter(([stage, info]) => matchStages.has(stage) && Number(info.matchCount || 0) > 0)
        .map(
          ([stage, info]) => `
            <div class="prizeRow">
              <strong>${escapeHtml(stage)}</strong>
              <span>${money(info.prizePerMatch)} per match</span>
            </div>
          `,
        )
        .join("")
    : `<div class="muted">No workbook prize table found.</div>`;
}

function renderResultBoard(model) {
  const liveItems = model.matchResults.filter((item) => item.isLive && item.score);
  const finalItems = model.matchResults.filter((item) => item.isFinal && item.score).slice(-6).reverse();
  const items = liveItems.length ? liveItems : finalItems;
  $("resultsStatus").textContent = liveItems.length ? `${liveItems.length} LIVE` : "LATEST RESULTS";
  $("resultsStatus").className = `badge ${liveItems.length ? "" : "final"}`;
  $("resultBoard").innerHTML = items.length
    ? items.map(resultCard).join("")
    : `<div class="emptyResults">No match results yet. This board updates automatically when games start.</div>`;
}

function renderUpcoming(model) {
  const upcoming = model.matchResults.filter((item) => !item.score).slice(0, 6);
  $("upcomingMatches").innerHTML = upcoming.length
    ? upcoming.map(upcomingCard).join("")
    : `<div class="emptyResults">No upcoming matches found.</div>`;
}

function upcomingCard(item) {
  return `
    <article class="upcomingCard">
      <div class="matchNo">${item.match.id}</div>
      <div>
        <strong>${escapeHtml(item.match.home || "TBD")} vs ${escapeHtml(item.match.away || "TBD")}</strong>
        <p class="matchMeta">${escapeHtml(item.match.stage)} ${item.match.group ? `| Group ${escapeHtml(item.match.group)}` : ""}</p>
        <p class="matchMeta">${escapeHtml(item.match.date || "Date TBD")} ${escapeHtml(item.match.time || "")} | ${escapeHtml(item.match.venue || "Venue TBD")}</p>
      </div>
      <span class="badge scheduled">Scheduled</span>
    </article>
  `;
}

function resultCard(item) {
  const score = item.score ? `${item.score[0]}-${item.score[1]}` : "-";
  const winners = winnerText(item, "Rollover", "Pending");
  return `
    <article class="resultCard ${item.isLive ? "isLive" : ""}">
      <div class="resultTop">
        <span class="badge ${item.isFinal ? "final" : ""}">${item.isLive ? `LIVE ${item.minute || ""}` : item.status}</span>
        <span>${escapeHtml(item.match.stage)}</span>
      </div>
      <div class="resultTeams">
        <strong>${escapeHtml(item.match.home || "TBD")}</strong>
        <div class="resultScore">${score}</div>
        <strong>${escapeHtml(item.match.away || "TBD")}</strong>
      </div>
      <div class="matchMeta">#${item.match.id} | ${escapeHtml(item.match.venue || "Venue TBD")} | ${escapeHtml(item.source)}</div>
      <div class="winnerLine">${escapeHtml(item.winnerType)}: ${escapeHtml(winners)} | share ${money(item.prizePerWinner)} | prize ${money(item.match.prizePerMatch)}</div>
    </article>
  `;
}

function winnerText(item, rolloverText, pendingText) {
  if (item.winners.length) return item.winners.join(", ");
  return item.score ? rolloverText : pendingText;
}

function leaderRow(row, index) {
  return `
    <div class="leaderRow">
      <div class="rank">${index + 1}</div>
      <strong>${escapeHtml(row.name)}</strong>
      <div class="metric">${money(row.total)}<span>Total</span></div>
      <div class="metric">${row.exact}<span>Exact</span></div>
    </div>
  `;
}

function renderLeaderboard(model) {
  $("leaderboardTable").innerHTML = `
    <div class="tableHead"><span>Rank</span><span>Name</span><span>Total</span><span>Confirmed</span><span>Live</span><span>Exact</span><span>Wins</span></div>
    ${model.leaderboard
      .map(
        (row, index) => `
          <div class="tableRow">
            <strong>${index + 1}</strong>
            <strong>${escapeHtml(row.name)}</strong>
            <span>${money(row.total)}</span>
            <span>${money(row.confirmed)}</span>
            <span>${money(row.live)}</span>
            <span>${row.exact}</span>
            <span>${row.wins}</span>
          </div>
        `,
      )
      .join("")}
  `;
}

function renderMatches(model) {
  const query = $("searchInput").value.trim().toLowerCase();
  const stage = $("stageFilter").value;
  const status = $("statusFilter").value;
  const items = model.matchResults.filter((item) => {
    const text = `${item.match.home} ${item.match.away} ${item.match.venue} ${item.match.group} ${item.match.stage}`.toLowerCase();
    const statusKey = item.isLive ? "live" : item.isFinal ? "final" : "scheduled";
    return (!query || text.includes(query)) && (stage === "all" || item.match.stage === stage) && (status === "all" || status === statusKey);
  });
  $("matchesList").innerHTML = items.length ? items.map(matchCard).join("") : `<div class="muted">No matches match the current filters.</div>`;
}

function matchCard(item) {
  const score = item.score ? `${item.score[0]}-${item.score[1]}` : "-";
  const winners = winnerText(item, "Rollover to champion fund", "No result yet");
  return `
    <article class="matchCard">
      <div class="matchNo">${item.match.id}</div>
      <div>
        <div class="matchTeams">${escapeHtml(item.match.home || "TBD")} vs ${escapeHtml(item.match.away || "TBD")}</div>
        <div class="matchMeta">${escapeHtml(item.match.stage)} ${item.match.group ? `| Group ${escapeHtml(item.match.group)}` : ""} | ${escapeHtml(item.match.date || "Date TBD")} ${escapeHtml(item.match.time || "")}</div>
        <div class="matchMeta">${escapeHtml(item.match.venue || "Venue TBD")} | ${escapeHtml(item.status)} | ${escapeHtml(item.source)}</div>
        <div class="winnerLine">${escapeHtml(item.winnerType)}: ${escapeHtml(winners)} | share ${money(item.prizePerWinner)} | prize ${money(item.match.prizePerMatch)}</div>
      </div>
      <div class="matchScore">${score}</div>
    </article>
  `;
}

function renderParticipant(model) {
  const name = $("participantSelect").value || state.data.participants[0];
  const row = model.leaderboard.find((item) => item.name === name);
  const cards = model.matchResults
    .filter((item) => item.match.predictions?.[name])
    .map((item) => {
      const guess = item.match.predictions[name];
      const won = item.winners.includes(name);
      return `
        <div class="participantCard">
          <strong>#${item.match.id} ${escapeHtml(item.match.home || "TBD")} ${guess[0]}-${guess[1]} ${escapeHtml(item.match.away || "TBD")}</strong>
          <p class="muted">${item.score ? `Actual ${item.score[0]}-${item.score[1]}` : "No result yet"} | ${won ? `Won ${money(item.prizePerWinner)} as ${item.winnerType}` : "No payout"}</p>
        </div>
      `;
    })
    .join("");
  $("participantDetail").innerHTML = `
    <div class="kpis">
      <div><strong>${money(row?.total || 0)}</strong><span>Total</span></div>
      <div><strong>${row?.exact || 0}</strong><span>Exact wins</span></div>
      <div><strong>${row?.outcome || 0}</strong><span>Outcome wins</span></div>
      <div><strong>${row?.wins || 0}</strong><span>Paid matches</span></div>
    </div>
    ${cards}
  `;
}

function renderPredictionTrends() {
  const matches = state.data.matches.slice(0, 12);
  $("predictionTrends").innerHTML = matches
    .map((match) => {
      const counts = {};
      Object.values(match.predictions || {}).forEach((score) => {
        const key = `${score[0]}-${score[1]}`;
        counts[key] = (counts[key] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const max = sorted[0]?.[1] || 1;
      return `
        <article class="trendCard">
          <strong>#${match.id} ${escapeHtml(match.home || "TBD")} vs ${escapeHtml(match.away || "TBD")}</strong>
          ${sorted
            .slice(0, 5)
            .map(
              ([score, count]) => `
                <div>
                  <div class="sectionTitle"><span class="muted">${score}</span><span class="muted">${count}</span></div>
                  <div class="bar"><i style="width:${Math.max(5, (count / max) * 100)}%"></i></div>
                </div>
              `,
            )
            .join("")}
        </article>
      `;
    })
    .join("");
}

function formatTime(value) {
  if (!value) return "never";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

boot().catch((error) => {
  $("feedStatus").textContent = error.message;
});
