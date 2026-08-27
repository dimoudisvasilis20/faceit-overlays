const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function curlJson(url) {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-s',
      '-A',
      USER_AGENT,
      '-H',
      'Referer: https://www.faceit.com/en/players/',
      '-H',
      'Accept: application/json',
      url,
    ],
    { timeout: 8000, maxBuffer: 5 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

let cachedPlayerId = null;
let cachedForNickname = null;

async function resolvePlayerId(server, nickname) {
  if (cachedPlayerId && cachedForNickname === nickname) return cachedPlayerId;
  const res = await fetch(`${server}/api/player?nickname=${encodeURIComponent(nickname)}`);
  const data = await res.json();
  if (!data.playerId) throw new Error(`Could not resolve FACEIT player id for "${nickname}"`);
  cachedPlayerId = data.playerId;
  cachedForNickname = nickname;
  return cachedPlayerId;
}

// One relay cycle: find the current match id (if any) and push it to the
// overlay server. Returns a short status string for the tray UI.
async function tick({ server, nickname, token }) {
  const playerId = await resolvePlayerId(server, nickname);

  let matchId = null;
  try {
    const body = await curlJson(
      `https://www.faceit.com/api/match/v1/matches/groupByState?userId=${playerId}`
    );
    const ongoing = body?.payload?.ONGOING;
    matchId = Array.isArray(ongoing) ? ongoing[0]?.id ?? null : null;
  } catch (err) {
    throw new Error(`Match lookup failed: ${err.message}`);
  }

  await fetch(`${server}/api/matchpush/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  });

  return matchId ? `Live match found (${matchId})` : 'No live match';
}

function resetPlayerIdCache() {
  cachedPlayerId = null;
  cachedForNickname = null;
}

module.exports = { tick, resetPlayerIdCache };
