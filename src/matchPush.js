// Holds the FACEIT match id most recently pushed by the streamer's local
// helper script (see local-helper/live-match-relay.js), keyed by their
// private token. The helper runs on the streamer's own PC, where FACEIT's
// bot-protection doesn't challenge the lookup - the server just needs the
// resulting match id, not to do the lookup itself.

const STALE_AFTER_MS = 30_000;

const pushes = new Map();

export function ingestMatchPush(token, matchId) {
  pushes.set(token, { matchId: matchId || null, updatedAt: Date.now() });
}

export function getPushedMatchId(token) {
  const entry = pushes.get(token);
  if (!entry || Date.now() - entry.updatedAt > STALE_AFTER_MS) return null;
  return entry.matchId;
}
