// FACEIT live match relay - run locally on your streaming PC: node live-match-relay.mjs
//
// Looks up your current FACEIT match every 10s from this PC (where FACEIT's
// bot-protection doesn't challenge the lookup, unlike a cloud-hosted server)
// and reports the match id to the overlay server, which uses it to build
// roster.html from the official Data API.
//
// Don't hand-edit the placeholders below - regenerate this file from
// /local-helper-setup.html on your deployment, which fills in your actual
// nickname, token, and server URL.
//
// Requires Node.js 18+ and curl (curl.exe ships with Windows 10/11 by default).

const NICKNAME = 'YOUR-FACEIT-NICKNAME';
const TOKEN = 'YOUR-TOKEN';
const SERVER = 'https://faceit-overlays.onrender.com';
const INTERVAL_MS = 10_000;

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

async function curlJson(url) {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-s',
      '-A',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
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

let playerId = null;

async function ensurePlayerId() {
  if (playerId) return playerId;
  const res = await fetch(`${SERVER}/api/player?nickname=${encodeURIComponent(NICKNAME)}`);
  const data = await res.json();
  if (!data.playerId) throw new Error('Could not resolve player id for ' + NICKNAME);
  playerId = data.playerId;
  return playerId;
}

async function tick() {
  try {
    const pid = await ensurePlayerId();
    let matchId = null;
    try {
      const body = await curlJson(
        `https://www.faceit.com/api/match/v1/matches/groupByState?userId=${pid}`
      );
      const ongoing = body?.payload?.ONGOING;
      matchId = Array.isArray(ongoing) ? ongoing[0]?.id ?? null : null;
    } catch (err) {
      console.error('lookup failed:', err.message);
    }

    await fetch(`${SERVER}/api/matchpush/${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    });
    console.log(new Date().toLocaleTimeString(), matchId ? `live match: ${matchId}` : 'no live match');
  } catch (err) {
    console.error('tick failed:', err.message);
  }
}

console.log('FACEIT live match relay running for', NICKNAME, '- Ctrl+C to stop.');
tick();
setInterval(tick, INTERVAL_MS);
