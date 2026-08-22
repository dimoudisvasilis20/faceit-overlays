// Shared helpers for all overlay pages: level-ring math, session-based ELO
// delta tracking, and a small fetch wrapper. Loaded as a plain script
// (no bundler in this project), so everything hangs off `window`.

const LEVEL_RANGES = {
  1: [100, 501], 2: [501, 751], 3: [751, 901], 4: [901, 1051],
  5: [1051, 1201], 6: [1201, 1351], 7: [1351, 1531], 8: [1531, 1751],
  9: [1751, 2001], 10: [2001, null],
};

const LEVEL_COLORS = {
  1: '#cfcfcf', 2: '#cfcfcf', 3: '#a1e75b', 4: '#a1e75b',
  5: '#f7b420', 6: '#f7b420', 7: '#f7b420',
  8: '#fc5f5f', 9: '#fc5f5f', 10: '#ff5500',
};

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function levelColor(level) {
  return LEVEL_COLORS[level] || '#666';
}

function renderLevelRing(progressCircleEl, level, elo) {
  const range = LEVEL_RANGES[level];
  progressCircleEl.style.stroke = levelColor(level);
  progressCircleEl.style.strokeDasharray = String(RING_CIRCUMFERENCE);

  let fraction = 1;
  if (range && range[1] != null) {
    fraction = (elo - range[0]) / (range[1] - range[0]);
    fraction = Math.max(0, Math.min(1, fraction));
  }
  progressCircleEl.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
}

// Tracks ELO change since this overlay page was first loaded this
// browser session (not "today" - see README for why).
function eloDeltaSinceSessionStart(nickname, elo) {
  const key = 'faceit-overlay-baseline-elo:' + (nickname || 'default');
  let baseline = Number(sessionStorage.getItem(key));
  if (!baseline) {
    baseline = elo;
    sessionStorage.setItem(key, String(elo));
  }
  return elo - baseline;
}

async function fetchOverlayJSON(path, nickname) {
  const qs = nickname ? `?nickname=${encodeURIComponent(nickname)}` : '';
  const res = await fetch(path + qs);
  if (!res.ok) throw new Error('bad response: ' + path);
  return res.json();
}
