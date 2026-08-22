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

