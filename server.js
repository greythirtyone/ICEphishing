import express from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const app = express();
const defaultPort = process.env.PORT || 8787;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wigleCache = new Map();
const WIGLE_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

// SSIDs that are too generic or ISP-managed to yield useful WiGLE location data.
// These are carrier hotspots, opt-out networks, or ubiquitous public SSIDs.
const WIGLE_SKIP_PATTERNS = [
  /xfinity/i,
  /cablewifi/i,
  /twcwifi/i,
  /optimumwifi/i,
  /spectrumwifi/i,
  /at[&t]?wifi/i,
  /attwifi/i,
  /coxwifi/i,
  /centurylink/i,
  /boingo/i,
  /googleguest/i,
  /google[-_\s]?wifi/i,
  /^DIRECT-/i,       // printer/device P2P hotspots
  /_nomap$/i,        // explicitly opted out of location mapping
  /^AndroidAP/i,
  /^iPhone/i,
  /^iPad/i,
  /^Galaxy/i,
  /^Pixel[\s_]/i,
];

function shouldSkipWigle(ssid) {
  const s = String(ssid || '').trim();
  if (!s) return true;
  return WIGLE_SKIP_PATTERNS.some((pattern) => pattern.test(s));
}
const YAML_DEFAULT_PATHS = [
  path.join(__dirname, 'icephisher.local.yaml'),
  path.join(__dirname, 'config.local.yaml'),
  path.join(__dirname, 'icephisher.defaults.yaml'),
  path.join(__dirname, 'config.yaml'),
];

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/config/defaults', (_req, res) => {
  try {
    const defaults = loadYamlDefaults();
    return res.json({ defaults });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to read YAML defaults' });
  }
});

const KISMET_FIELDS = [
  'kismet.device.base.macaddr',
  'kismet.device.base.last_time',
  'kismet.device.base.signal',
  'dot11.device/dot11.device.advertised_ssid_map',
];

app.post('/api/kismet/ping', async (req, res) => {
  try {
    const { host, user, pass } = req.body || {};
    if (!host || !user || !pass) {
      return res.status(400).json({ ok: false, error: 'host, user, and pass are required' });
    }
    const normalizedHost = normalizeHost(host);
    const url = `${normalizedHost.replace(/\/$/, '')}/system/status.json`;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return res.status(response.status).json({ ok: false, error: `Kismet responded with ${response.status}` });
      }
      return res.json({ ok: true });
    } catch (fetchErr) {
      clearTimeout(timeout);
      throw fetchErr;
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Ping failed' });
  }
});

app.post('/api/kismet/fetch', async (req, res) => {
  try {
    const { host, user, pass, endpoint } = req.body || {};

    if (!host || !user || !pass) {
      return res.status(400).json({ error: 'host, user, and pass are required' });
    }

    const normalizedHost = normalizeHost(host);
    const normalizedEndpoint = String(endpoint || '/devices/views/all/devices.json').startsWith('/')
      ? String(endpoint || '/devices/views/all/devices.json')
      : `/${String(endpoint || '/devices/views/all/devices.json')}`;

    const url = `${normalizedHost.replace(/\/$/, '')}${normalizedEndpoint}`;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields: KISMET_FIELDS }),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Kismet request failed (${response.status})` });
    }

    const raw = await response.json();
    // Strip devices that have no advertised SSIDs (value is 0 or not an object).
    // These are client devices — they probe for networks but don't advertise any.
    const data = Array.isArray(raw)
      ? raw.filter((d) => d && typeof d['dot11.device.advertised_ssid_map'] === 'object' && d['dot11.device.advertised_ssid_map'] !== null)
      : raw;
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.post('/api/kismet/devices', async (req, res) => {
  try {
    const { host, user, pass, endpoint } = req.body || {};

    if (!host || !user || !pass) {
      return res.status(400).json({ error: 'host, user, and pass are required' });
    }

    const normalizedHost = normalizeHost(host);
    const normalizedEndpoint = String(endpoint || '/devices/views/all/devices.json').startsWith('/')
      ? String(endpoint || '/devices/views/all/devices.json')
      : `/${String(endpoint || '/devices/views/all/devices.json')}`;

    const url = `${normalizedHost.replace(/\/$/, '')}${normalizedEndpoint}`;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Kismet request failed (${response.status})` });
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return res.status(502).json({ error: 'Unexpected Kismet payload: expected array' });
    }

    return res.json({ devices: data });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.post('/api/wigle/lookup', async (req, res) => {
  try {
    const { ssid, wigleKey } = req.body || {};
    if (!ssid) return res.status(400).json({ error: 'ssid is required' });
    if (!wigleKey) return res.json({ address: '', city: '', state: '', cached: false, skipped: false });

    const normalizedSsid = String(ssid).trim();

    // Skip common carrier/ISP SSIDs — they're everywhere, WiGLE results are useless for location
    if (shouldSkipWigle(normalizedSsid)) {
      return res.json({ address: '', city: '', state: '', cached: false, skipped: true });
    }

    const cacheKey = normalizedSsid.toLowerCase();
    const cacheEntry = wigleCache.get(cacheKey);
    if (cacheEntry && Date.now() - cacheEntry.ts < WIGLE_CACHE_TTL_MS) {
      return res.json({ ...cacheEntry.value, cached: true, skipped: false });
    }

    const auth = buildWigleAuth(wigleKey);

    const url = `https://api.wigle.net/api/v2/network/search?onlymine=false&freenet=false&ssid=${encodeURIComponent(
      normalizedSsid,
    )}&resultsPerPage=5`;

    const WIGLE_MAX_RETRIES = 4;
    const WIGLE_BASE_DELAY_MS = 1000;

    let lastStatus = null;
    let data = null;

    for (let attempt = 0; attempt <= WIGLE_MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: auth },
      });
      lastStatus = response.status;

      if (response.status === 429) {
        if (attempt === WIGLE_MAX_RETRIES) break;
        const delayMs = WIGLE_BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
        console.warn(`WiGLE 429 rate limit — retrying in ${delayMs}ms (attempt ${attempt + 1}/${WIGLE_MAX_RETRIES})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      if (!response.ok) {
        const hint = response.status === 401
          ? 'WiGLE auth failed (401) — use "apiName:apiToken" format from your WiGLE account API page, or paste the full "Encoded for use" value'
          : `WiGLE request failed (${response.status})`;
        return res.status(response.status).json({ error: hint });
      }

      data = await response.json();
      break;
    }

    if (data === null) {
      return res.status(429).json({ error: `WiGLE rate limit exceeded after ${WIGLE_MAX_RETRIES} retries` });
    }

    const first = data?.results?.[0];
    const value = first
      ? {
          address: [first.road, first.housenumber].filter(Boolean).join(' ').trim(),
          city: first.city || '',
          state: first.region || '',
          lat: typeof first.trilat === 'number' ? first.trilat : null,
          lng: typeof first.trilong === 'number' ? first.trilong : null,
        }
      : { address: '', city: '', state: '', lat: null, lng: null };

    wigleCache.set(cacheKey, { ts: Date.now(), value });
    pruneWigleCache();

    return res.json({ ...value, cached: false, skipped: false });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

export function startServer(port = defaultPort) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const actualPort = server.address()?.port;
      console.log(`kismet-probe-spa listening on http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

function normalizeHost(host) {
  const raw = String(host || '').trim();
  if (!raw) throw new Error('Host is required');

  if (/^https?:\/\//i.test(raw)) return raw;

  return `http://${raw}`;
}

function buildWigleAuth(wigleKey) {
  const trimmed = String(wigleKey).trim();
  if (/^Basic\s+/i.test(trimmed)) return trimmed;
  if (trimmed.includes(':')) {
    // Preferred WiGLE format: "apiName:apiToken"
    return `Basic ${Buffer.from(trimmed).toString('base64')}`;
  }
  // Backward-compatible fallback (legacy single value)
  return `Basic ${Buffer.from(`${trimmed}:`).toString('base64')}`;
}

function pruneWigleCache() {
  if (wigleCache.size < 500) return;
  const now = Date.now();
  for (const [key, entry] of wigleCache.entries()) {
    if (now - entry.ts >= WIGLE_CACHE_TTL_MS) wigleCache.delete(key);
  }
}

function loadYamlDefaults() {
  for (const filePath of YAML_DEFAULT_PATHS) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) || {};

    return {
      host: String(parsed.host || '').trim(),
      user: String(parsed.user || '').trim(),
      pass: String(parsed.pass || '').trim(),
      eventEndpoint: String(parsed.eventEndpoint || '/devices/views/all/devices.json').trim(),
      wigleKey: String(parsed.wigleKey || '').trim(),
      claudeKey: String(parsed.claudeKey || '').trim(),
      debug: Boolean(parsed.debug),
      displayCommonSsid: Boolean(parsed.display_common_ssid),
    };
  }

  return {
    host: '',
    user: '',
    pass: '',
    eventEndpoint: '/devices/views/all/devices.json',
    wigleKey: '',
    claudeKey: '',
    debug: false,
    displayCommonSsid: false,
  };
}
