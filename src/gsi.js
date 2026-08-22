// CS2 Game State Integration: the game client itself POSTs live match state
// to a URL we control, whenever it changes. This is an official Valve
// feature (unrelated to FACEIT), so it isn't subject to any bot-detection
// and gives richer, more immediate data than polling any web API could.
// State only exists for as long as the streamer's own game client is
// actively sending it, keyed by the token they put in their config file.

const STALE_AFTER_MS = 45_000;

const states = new Map();

export function ingestGsiPayload(token, body) {
  const map = body.map || {};
  const round = body.round || {};
  const player = body.player || {};
  const allplayers = body.allplayers || {};

  const players = Object.entries(allplayers).map(([steamId, p]) => ({
    steamId,
    name: p.name || null,
    team: p.team || null,
  }));

  states.set(token, {
    map: map.name || null,
    phase: map.phase || null,
    round: map.round ?? null,
    ctScore: map.team_ct?.score ?? null,
    tScore: map.team_t?.score ?? null,
    playerTeam: player.team || null,
    playerName: player.name || null,
    bomb: round.bomb || null,
    players,
    updatedAt: Date.now(),
  });
}

export function getGsiState(token) {
  const state = states.get(token);
  if (!state || Date.now() - state.updatedAt > STALE_AFTER_MS) {
    return { live: false };
  }
  return { live: true, ...state };
}
