const DATA_API = 'https://open.faceit.com/data/v4';
const GAME_ID = 'cs2';

const cache = new Map();

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.time < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { value, time: now });
  return value;
}

function authHeaders() {
  const apiKey = process.env.FACEIT_API_KEY;
  if (!apiKey) throw new Error('FACEIT_API_KEY is not set in .env');
  return { Authorization: `Bearer ${apiKey}` };
}

async function dataApiGet(path) {
  const res = await fetch(`${DATA_API}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FACEIT API ${res.status} on ${path}: ${body}`);
  }
  return res.json();
}

export async function getPlayerByNickname(nickname) {
  return cached(`player:${nickname}`, 20_000, () =>
    dataApiGet(`/players?nickname=${encodeURIComponent(nickname)}`)
  );
}

export async function getPlayerStats(playerId) {
  return cached(`stats:${playerId}`, 20_000, () =>
    dataApiGet(`/players/${playerId}/stats/${GAME_ID}`)
  );
}

async function summarizePlayer(player) {
  const gameData = player.games?.[GAME_ID];
  if (!gameData) return null;

  const stats = await getPlayerStats(player.player_id).catch(() => null);
  const lifetime = stats?.lifetime ?? {};

  const totalKills = Number(lifetime['Total Kills with extended stats']);
  const totalMatches = Number(lifetime['Total Matches']);
  const avgKills = totalKills && totalMatches ? Math.round((totalKills / totalMatches) * 10) / 10 : null;

  return {
    playerId: player.player_id,
    nickname: player.nickname,
    avatar: player.avatar || null,
    country: player.country || null,
    faceitUrl: player.faceit_url?.replace('{lang}', 'en') || null,
    elo: gameData.faceit_elo ?? null,
    level: gameData.skill_level ?? null,
    stats: {
      matches: lifetime['Matches'] ?? null,
      winRatePct: lifetime['Win Rate %'] ?? null,
      kd: lifetime['Average K/D Ratio'] ?? null,
      kr: lifetime['Average K/R Ratio'] ?? null,
      headshotPct: lifetime['Average Headshots %'] ?? null,
      currentWinStreak: lifetime['Current Win Streak'] ?? null,
      longestWinStreak: lifetime['Longest Win Streak'] ?? null,
      adr: lifetime['ADR'] ?? null,
      avgKills,
    },
  };
}

export async function getPlayerSummary(nickname) {
  const player = await getPlayerByNickname(nickname);
  const summary = await summarizePlayer(player);
  if (!summary) {
    throw new Error(`Player "${nickname}" has no ${GAME_ID} data on FACEIT`);
  }
  return summary;
}

export async function getPlayerById(playerId) {
  return cached(`byid:${playerId}`, 20_000, () => dataApiGet(`/players/${playerId}`));
}

async function summarizeRosterMember(rosterEntry) {
  const [playerFull, stats] = await Promise.all([
    getPlayerById(rosterEntry.player_id).catch(() => null),
    getPlayerStats(rosterEntry.player_id).catch(() => null),
  ]);
  const gameData = playerFull?.games?.[GAME_ID];
  const lifetime = stats?.lifetime ?? {};

  const totalKills = Number(lifetime['Total Kills with extended stats']);
  const totalMatches = Number(lifetime['Total Matches']);
  const avgKills = totalKills && totalMatches ? Math.round((totalKills / totalMatches) * 10) / 10 : null;

  return {
    playerId: rosterEntry.player_id,
    nickname: rosterEntry.nickname,
    avatar: rosterEntry.avatar || playerFull?.avatar || null,
    country: playerFull?.country || null,
    elo: gameData?.faceit_elo ?? null,
    level: gameData?.skill_level ?? rosterEntry.game_skill_level ?? null,
    stats: {
      winRatePct: lifetime['Win Rate %'] ?? null,
      kd: lifetime['Average K/D Ratio'] ?? null,
      headshotPct: lifetime['Average Headshots %'] ?? null,
      avgKills,
    },
  };
}

// Full roster + live score for a match, given its id. FACEIT's own website
// calls an internal, undocumented endpoint to discover "current match id"
// for a player, but it's behind Cloudflare bot-protection that challenges
// requests from datacenter IPs (confirmed by testing: the same request
// succeeds from a home connection and gets a Cloudflare interactive
// challenge page from Render) - not something fixable with headers or a
// different HTTP client. So match-id discovery happens on the streamer's
// own PC instead (see local-helper/) and gets pushed to /api/matchpush/:token;
// this function just takes whatever id it was given and builds the roster
// from the official Data API, which has no such restriction and, unlike the
// GSI allplayers approach, no "must be spectating" restriction either - it
// works continuously for the whole match.
export async function getLiveMatchRoster(nickname, matchId) {
  const player = await getPlayerByNickname(nickname);
  if (!matchId) return { live: false };

  const match = await dataApiGet(`/matches/${matchId}`).catch(() => null);
  if (!match) return { live: false };

  const factionEntries = Object.entries(match.teams || {});
  const myEntry = factionEntries.find(([, team]) =>
    team.roster?.some((p) => p.player_id === player.player_id)
  );
  const otherEntry = factionEntries.find(([faction]) => faction !== myEntry?.[0]);

  const mapPick = match.voting?.map?.pick?.[0] ?? null;
  const mapEntity = match.voting?.map?.entities?.find(
    (e) => e.class_name === mapPick || e.guid === mapPick
  );

  const [mine, enemy] = await Promise.all([
    Promise.all((myEntry?.[1]?.roster || []).map(summarizeRosterMember)),
    Promise.all((otherEntry?.[1]?.roster || []).map(summarizeRosterMember)),
  ]);

  return {
    live: true,
    map: mapEntity?.name ?? mapPick,
    status: match.status ?? null,
    myScore: myEntry ? match.results?.score?.[myEntry[0]] ?? null : null,
    enemyScore: otherEntry ? match.results?.score?.[otherEntry[0]] ?? null : null,
    mine,
    enemy,
  };
}

export async function getTodaySummary(nickname) {
  const player = await getPlayerByNickname(nickname);
  const playerId = player.player_id;
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400); // UTC day boundary

  return cached(`today:${playerId}:${startOfDay}`, 30_000, async () => {
    const history = await dataApiGet(
      `/players/${playerId}/history?game=${GAME_ID}&from=${startOfDay}&to=${now}&limit=50`
    ).catch(() => ({ items: [] }));

    let wins = 0;
    let losses = 0;
    for (const match of history.items || []) {
      if (match.status !== 'finished') continue;
      const inFaction1 = match.teams?.faction1?.players?.some((p) => p.player_id === playerId);
      const inFaction2 = match.teams?.faction2?.players?.some((p) => p.player_id === playerId);
      const myFaction = inFaction1 ? 'faction1' : inFaction2 ? 'faction2' : null;
      if (!myFaction) continue;
      if (match.results?.winner === myFaction) wins += 1;
      else losses += 1;
    }
    return { wins, losses };
  });
}

