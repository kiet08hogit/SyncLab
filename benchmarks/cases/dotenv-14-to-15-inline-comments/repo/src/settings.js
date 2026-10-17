const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const DEFAULTS_FILE = path.join(__dirname, 'defaults.env');

function loadSettings(overrides = {}) {
  const defaults = dotenv.parse(fs.readFileSync(DEFAULTS_FILE));
  const env = { ...defaults, ...overrides };
  return {
    appName: env.APP_NAME,
    port: Number(env.PORT),
    brandColor: env.BRAND_COLOR,
    database: { password: env.DB_PASSWORD },
    supportChannel: env.SUPPORT_CHANNEL,
  };
}

module.exports = { loadSettings };
