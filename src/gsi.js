// CS2 Game State Integration: the game client itself POSTs live match state
// to a URL we control, whenever it changes. This is an official Valve
// feature (unrelated to FACEIT), so it isn't subject to any bot-detection
// and gives richer, more immediate data than polling any web API could.
// State only exists for as long as the streamer's own game client is
// actively sending it, keyed by the token they put in their config file.

const STALE_AFTER_MS = 45_000;

const states = new Map();

function activeWeapon(weapons) {
  const active = Object.values(weapons || {}).find((w) => w.state === 'active');
  if (!active) return { name: null, type: null };
  return { name: active.name?.replace(/^weapon_/, '') || null, type: active.type || null };
}

// World-to-radar calibration (top-left world X/Y and world-units-per-pixel)
// for the current active-duty map pool. These are just numeric constants
// (not game art) published by Valve's own map resource files and widely
// known in the mapping/GSI community - not copyrighted content. Used to
// place live position dots on our own plain radar background, never to
// reproduce the actual map artwork.
const MAP_CALIBRATION = {
  de_dust2: { x: -2476, y: 3239, scale: 4.4 },
  de_mirage: { x: -3230, y: 1713, scale: 5.0 },
  de_inferno: { x: -2087, y: 3870, scale: 4.9 },
  de_nuke: { x: -3453, y: 2887, scale: 7.0 },
  de_overpass: { x: -4831, y: 1781, scale: 5.2 },
  de_vertigo: { x: -3168, y: 1762, scale: 4.0 },
  de_ancient: { x: -2953, y: 2164, scale: 5.0 },
  de_anubis: { x: -2796, y: 3328, scale: 5.22 },
  de_train: { x: -2308, y: 2078, scale: 4.082 },
};

function toRadarCoords(mapName, positionStr) {
  const cal = MAP_CALIBRATION[mapName];
  if (!cal || !positionStr) return { x: null, y: null };
  const parts = positionStr.split(',').map((n) => Number(n.trim()));
  if (parts.length < 2 || parts.some(Number.isNaN)) return { x: null, y: null };
  const [worldX, worldY] = parts;
  // Normalized 0-1 within the map's 1024x1024 radar space.
  const x = (worldX - cal.x) / cal.scale / 1024;
  const y = (cal.y - worldY) / cal.scale / 1024;
  return { x, y };
}

export function ingestGsiPayload(token, body) {
  const map = body.map || {};
  const round = body.round || {};
  const player = body.player || {};
  const allplayers = body.allplayers || {};

  // Full per-player live state (health/armor/money/weapon) for everyone,
  // not just the local player. GSI only actually populates this while the
  // reporting client is spectating/observing, not while actively playing -
  // see README - so in solo-stream use this stays empty for teammates and
  // opponents; a dedicated observer/GOTV client feeding GSI is what makes
  // it populate for all 10.
  const players = Object.entries(allplayers).map(([steamId, p]) => {
    const weapon = activeWeapon(p.weapons);
    const radar = toRadarCoords(map.name, p.position);
    return {
      steamId,
      name: p.name || null,
      team: p.team || null,
      health: p.state?.health ?? null,
      armor: p.state?.armor ?? null,
      money: p.state?.money ?? null,
      kills: p.match_stats?.kills ?? null,
      weaponName: weapon.name,
      weaponType: weapon.type,
      radarX: radar.x,
      radarY: radar.y,
    };
  });

  states.set(token, {
    map: map.name || null,
    phase: map.phase || null,
    round: map.round ?? null,
    ctScore: map.team_ct?.score ?? null,
    tScore: map.team_t?.score ?? null,
    // Seconds left in the current round phase (freezetime/live/etc.), as a
    // string straight from GSI - only present while a phase is actively
    // counting down.
    phaseEndsIn: map.phase_countdowns?.phase_ends_in ?? null,
    playerTeam: player.team || null,
    playerName: player.name || null,
    playerSteamId: player.steamid || null,
    // Only the local player's own state/weapon is reliably available while
    // actively playing - see README for why allplayers_state can't power a
    // full 10-player live scoreboard without a spectating/observer client.
    playerHealth: player.state?.health ?? null,
    playerArmor: player.state?.armor ?? null,
    playerMoney: player.state?.money ?? null,
    playerKills: player.match_stats?.kills ?? null,
    playerWeapon: activeWeapon(player.weapons).name,
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
