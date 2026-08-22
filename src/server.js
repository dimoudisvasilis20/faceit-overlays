import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlayerSummary, getLiveMatchSummary, getTodaySummary } from './faceit.js';
import { rateLimit } from './rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;

// Needed so req.ip reflects the real client IP behind Render's proxy.
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', rateLimit);

function resolveNickname(req) {
  return req.query.nickname || process.env.DEFAULT_NICKNAME;
}

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

app.get('/api/live', async (req, res) => {
  const nickname = resolveNickname(req);
  if (!nickname) {
    return res.status(400).json({ error: 'Missing ?nickname= and no DEFAULT_NICKNAME set' });
  }
  try {
    res.json(await getLiveMatchSummary(nickname));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`FACEIT overlays running: http://localhost:${PORT}`);
});
