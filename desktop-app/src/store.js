const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const filePath = () => path.join(app.getPath('userData'), 'config.json');

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function load() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function save(config) {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(config, null, 2));
}

function getConfig() {
  const config = load();
  if (!config.token) {
    config.token = randomToken();
    save(config);
  }
  if (!config.server) {
    config.server = 'https://faceit-overlays.onrender.com';
    save(config);
  }
  return config;
}

function setNickname(nickname) {
  const config = getConfig();
  config.nickname = nickname;
  save(config);
  return config;
}

module.exports = { getConfig, setNickname };
