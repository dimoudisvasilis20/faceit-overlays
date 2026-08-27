import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlayerSummary, getTodaySummary, getLiveMatchRoster } from './faceit.js';
import { ingestGsiPayload, getGsiState } from './gsi.js';
import { ingestMatchPush, getPushedMatchId } from './matchPush.js';
import { rateLimit } from './rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;

// Needed so req.ip reflects the real client IP behind Render's proxy.
app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function resolveNickname(req) {
  return req.query.nickname || process.env.DEFAULT_NICKNAME;
}

// CS2 posts here directly, and the overlay polls the GET route every few
// seconds - both are cheap in-memory operations local to this server, not
// calls to FACEIT, so neither needs the shared-quota rate limit below.
app.post('/gsi/:token', (req, res) => {
  ingestGsiPayload(req.params.token, req.body || {});
  res.sendStatus(200);
});

app.get('/api/gsi/:token', (req, res) => {
  res.json(getGsiState(req.params.token));
});

// The streamer's local live-match-relay script posts here (see
// local-helper/live-match-relay.js) - cheap in-memory write, not a call to
// FACEIT, so it doesn't need the shared-quota rate limit below either.
app.post('/api/matchpush/:token', (req, res) => {
  ingestMatchPush(req.params.token, req.body?.matchId);
  res.sendStatus(200);
});

app.use('/api', rateLimit);

app.get('/api/player', async (req, res) => {
  const nickname = resolveNickname(req);
  if (!nickname) {
    return res.status(400).json({ error: 'Missing ?nickname= and no DEFAULT_NICKNAME set' });
  }
  try {
    res.json(await getPlayerSummary(nickname));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/today', async (req, res) => {
  const nickname = resolveNickname(req);
  if (!nickname) {
    return res.status(400).json({ error: 'Missing ?nickname= and no DEFAULT_NICKNAME set' });
  }
  try {
    res.json(await getTodaySummary(nickname));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/liveroster', async (req, res) => {
  const nickname = resolveNickname(req);
  const token = req.query.token;
  if (!nickname) {
    return res.status(400).json({ error: 'Missing ?nickname= and no DEFAULT_NICKNAME set' });
  }
  if (!token) {
    return res.status(400).json({ error: 'Missing ?token= - run local-helper/live-match-relay.js' });
  }
  try {
    res.json(await getLiveMatchRoster(nickname, getPushedMatchId(token)));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`FACEIT overlays running: http://localhost:${PORT}`);
});
