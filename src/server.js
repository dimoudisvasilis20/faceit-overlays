import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { getPlayerSummary, getTodaySummary, getLiveMatchRoster } from './faceit.js';
import { ingestGsiPayload, getGsiState } from './gsi.js';
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
  if (!nickname) {
    return res.status(400).json({ error: 'Missing ?nickname= and no DEFAULT_NICKNAME set' });
  }
  try {
    res.json(await getLiveMatchRoster(nickname));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// TEMPORARY diagnostic route - remove once the curl-on-Render question is settled.
app.get('/api/debugcurl', (req, res) => {
  const userId = req.query.userId || '0e72edb6-a398-43ce-9fc6-a87c0f7d59cc';
  execFile(
    'curl',
    [
      '-s',
      '-A',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H',
      'Referer: https://www.faceit.com/en/players/',
      '-H',
      'Accept: application/json',
      '-w',
      '\n__STATUS__%{http_code}',
      `https://www.faceit.com/api/match/v1/matches/groupByState?userId=${userId}`,
    ],
    { timeout: 8000, maxBuffer: 5 * 1024 * 1024 },
    (err, stdout, stderr) => {
      res.json({ err: err ? { message: err.message, code: err.code } : null, stdout: stdout.slice(0, 1000), stderr });
    }
  );
});

app.listen(PORT, () => {
  console.log(`FACEIT overlays running: http://localhost:${PORT}`);
});
