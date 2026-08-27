import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

// FACEIT's own website calls an internal, undocumented endpoint to show
// "current match" state, but it's behind Cloudflare bot-protection that
// blocks Node's built-in fetch (undici) specifically by TLS fingerprint -
// confirmed by testing: identical headers succeed via curl and fail via
// fetch with a 403. Shelling out to curl for just this one call sidesteps
// that false positive without spoofing anything curl doesn't already send
// by default. Still best-effort: FACEIT could block curl's fingerprint too,
// with no warning, at any time - every caller must treat failures as
// "no live match" rather than an error.
async function curlJson(url, extraHeaders = {}) {
  const headerArgs = Object.entries(extraHeaders).flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-s',
      '-A',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      ...headerArgs,
      url,
    ],
    { timeout: 8000, maxBuffer: 5 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

async function getLiveMatchId(playerId) {
  return cached(`livematchid:${playerId}`, 8_000, async () => {
    try {
      const body = await curlJson(
        `https://www.faceit.com/api/match/v1/matches/groupByState?userId=${playerId}`,
        { Referer: 'https://www.faceit.com/en/players/', Accept: 'application/json' }
      );
      const ongoing = body?.payload?.ONGOING;
      return Array.isArray(ongoing) ? ongoing[0]?.id ?? null : null;
    } catch {
      return null;
    }
  });
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

// Full roster + live score for whatever match `nickname` is currently in,
// sourced entirely from FACEIT (official Data API for match/player details,
// the curl workaround above only to discover the match id). Unlike the GSI
// allplayers approach, this has no "must be spectating" restriction, so it
// works continuously for the whole match.
export async function getLiveMatchRoster(nickname) {
  const player = await getPlayerByNickname(nickname);
  const matchId = await getLiveMatchId(player.player_id);
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

