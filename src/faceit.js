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

export async function getPlayerSummary(nickname) {
  const player = await getPlayerByNickname(nickname);
  const gameData = player.games?.[GAME_ID];
  if (!gameData) {
    throw new Error(`Player "${nickname}" has no ${GAME_ID} data on FACEIT`);
  }

  const stats = await getPlayerStats(player.player_id).catch(() => null);
  const lifetime = stats?.lifetime ?? {};

  const totalKills = Number(lifetime['Total Kills with extended stats']);
  const totalMatches = Number(lifetime['Total Matches']);
  const avgKills = totalKills && totalMatches ? Math.round((totalKills / totalMatches) * 10) / 10 : null;

  return {
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

export async function getLastMatchResult(nickname) {
  const player = await getPlayerByNickname(nickname);
  const playerId = player.player_id;

  return cached(`lastmatch:${playerId}`, 15_000, async () => {
    const history = await dataApiGet(
      `/players/${playerId}/history?game=${GAME_ID}&limit=1`
    ).catch(() => ({ items: [] }));

    const match = history.items?.[0];
    if (!match || match.status !== 'finished') return { found: false };

    const inFaction1 = match.teams?.faction1?.players?.some((p) => p.player_id === playerId);
    const myFaction = inFaction1 ? 'faction1' : 'faction2';
    const otherFaction = myFaction === 'faction1' ? 'faction2' : 'faction1';

    return {
      found: true,
      matchId: match.match_id,
      won: match.results?.winner === myFaction,
      myScore: match.results?.score?.[myFaction] ?? null,
      otherScore: match.results?.score?.[otherFaction] ?? null,
      finishedAt: match.finished_at ?? null,
    };
  });
}

// Best-effort live-match detection using FACEIT's public web API (the same
// call faceit.com uses to show the "LIVE" badge on a profile). This is NOT
// part of the official documented Data API, has no key/auth, and can change
// or break at any time without notice. Callers must treat failures as
// "no live match" rather than a hard error.
async function getLiveMatchId(playerId) {
  try {
    const res = await fetch(
      `https://api.faceit.com/live/v1/matches?entity_id=${playerId}&entity_type=player`
    );
    if (!res.ok) return null;
    const body = await res.json();
    const matches = body?.payload ?? body?.matches ?? [];
    const match = Array.isArray(matches) ? matches[0] : null;
    return match?.match_id ?? match?.id ?? null;
  } catch {
    return null;
  }
}

export async function getLiveMatchSummary(nickname) {
  const player = await getPlayerByNickname(nickname);
  const playerId = player.player_id;
  const matchId = await getLiveMatchId(playerId);
  if (!matchId) return { live: false };

  const match = await dataApiGet(`/matches/${matchId}`).catch(() => null);
  if (!match) return { live: false };

  const teams = Object.values(match.teams || {});
  const myTeam = teams.find((t) =>
    t.roster?.some((p) => p.player_id === playerId)
  );
  const otherTeam = teams.find((t) => t !== myTeam);

  return {
    live: true,
    matchId,
    map: match.voting?.map?.pick?.[0] ?? null,
    status: match.status ?? null,
    myTeam: myTeam
      ? { name: myTeam.name, score: myTeam.roster?.length ? match.results?.score?.[myTeam.faction] : null }
      : null,
    otherTeam: otherTeam
      ? { name: otherTeam.name, score: match.results?.score?.[otherTeam.faction] }
      : null,
    faceitUrl: match.faceit_url?.replace('{lang}', 'en') || null,
  };
}
