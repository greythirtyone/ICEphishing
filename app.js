const els = {
  form: document.getElementById('settings-form'),
  host: document.getElementById('kismet-host'),
  user: document.getElementById('kismet-user'),
  pass: document.getElementById('kismet-pass'),
  eventEndpoint: document.getElementById('kismet-event-endpoint'),
  newerThanDate: document.getElementById('newer-than-date'),
  autoRefreshInterval: document.getElementById('auto-refresh-interval'),
  autoRefreshToggleBtn: document.getElementById('auto-refresh-toggle-btn'),
  wigleKey: document.getElementById('wigle-key'),
  connectBtn: document.getElementById('connect-btn'),
  pullDataBtn: document.getElementById('pull-data-btn'),
  clearDateBtn: document.getElementById('clear-date-btn'),
  enrichLocationBtn: document.getElementById('enrich-location-btn'),
  resetHistoryBtn: document.getElementById('reset-history-btn'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  cacheStats: document.getElementById('cache-stats'),
  status: document.getElementById('status'),
  rawPreviewMeta: document.getElementById('raw-preview-meta'),
  rawPreview: document.getElementById('raw-preview'),
  endpointWarning: document.getElementById('endpoint-warning'),
  metricTotalSsids: document.getElementById('metric-total-ssids'),
  metricDuplicates: document.getElementById('metric-duplicates'),
  metricStates: document.getElementById('metric-states'),
  resultsBody: document.getElementById('results-body'),
  ssidFilter: document.getElementById('ssid-filter'),
  filterCount: document.getElementById('filter-count'),
};

const STORAGE_KEY = 'kismet_probe_spa_settings_v2';
const RECORDS_STORAGE_KEY = 'kismet_probe_spa_records_v1';
const SEEN_EVENTS_STORAGE_KEY = 'kismet_probe_spa_seen_events_v1';
const MAX_SEEN_EVENT_KEYS = 5000;
let currentRows = [];
let filterQuery = '';
let cacheHitCount = 0;
let cacheMissCount = 0;
let sortBy = 'totalProbes';
let sortDirection = 'desc';
let autoRefreshTimer = null;
let autoRefreshPaused = true; // off by default; topbar toggle activates it
let connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let activeConnection = null;         // { host, user, pass, eventEndpoint, wigleKey }
let heartbeatTimer = null;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const ssidLocationCache = new Map();

// Mirrors the server-side WIGLE_SKIP_PATTERNS list — SSIDs too generic for useful results.
const COMMON_SSID_PATTERNS = [
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
  /^DIRECT-/i,
  /_nomap$/i,
  /^AndroidAP/i,
  /^iPhone/i,
  /^iPad/i,
  /^Galaxy/i,
  /^Pixel[\s_]/i,
];

function isCommonSsid(ssid) {
  return COMMON_SSID_PATTERNS.some((p) => p.test(String(ssid || '')));
}

let displayCommonSsid = false; // set from YAML defaults on init

async function initializeApp() {
  const yamlDefaults = await fetchYamlDefaults();
  loadSettings(yamlDefaults);
  currentRows = loadHistoricalRows();
  applySort();
  renderMetrics(currentRows);
  renderRows(currentRows);
  renderCacheStats();
  renderRawPreview([]);
  renderEndpointWarning(0, 1);
  els.exportCsvBtn.disabled = currentRows.length === 0;
  updateAutoRefreshUi();
  renderConnectionState();

  // Show raw event preview only when debug: true in YAML
  const rawPreviewSection = document.getElementById('raw-preview-section');
  if (rawPreviewSection) rawPreviewSection.style.display = yamlDefaults.debug ? '' : 'none';

  // Apply common SSID display preference from YAML
  displayCommonSsid = Boolean(yamlDefaults.displayCommonSsid);
  renderRows(currentRows);

  // Auto-connect if YAML provides full credentials
  if (yamlDefaults.host && yamlDefaults.user && yamlDefaults.pass) {
    await handleConnect();
  }
}

await initializeApp();

els.exportCsvBtn.addEventListener('click', () => exportCsv(getFilteredRows()));

els.ssidFilter.addEventListener('input', () => {
  filterQuery = els.ssidFilter.value.trim().toLowerCase();
  renderRows(currentRows);
});
els.resetHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear all saved SSID history and counts?')) return;
  currentRows = [];
  localStorage.removeItem(RECORDS_STORAGE_KEY);
  localStorage.removeItem(SEEN_EVENTS_STORAGE_KEY);
  renderMetrics(currentRows);
  renderRows(currentRows);
  els.exportCsvBtn.disabled = true;
  setStatus('History cleared.', 'warn');
});
els.clearDateBtn.addEventListener('click', () => {
  els.newerThanDate.value = '';
  saveSettings();
  setStatus('Date filter cleared. Click Pull Data to reload.', 'warn');
});

els.enrichLocationBtn.addEventListener('click', async () => {
  await runEnrichLocation();
});

els.resultsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-coord-btn');
  if (!btn) return;
  const coords = btn.dataset.coords;
  navigator.clipboard.writeText(coords).then(() => {
    const svg = btn.innerHTML;
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = svg; btn.classList.remove('copied'); }, 1500);
  }).catch(() => {
    btn.textContent = '✗';
    setTimeout(() => { btn.textContent = '⧉'; }, 1500);
  });
});

els.autoRefreshInterval.addEventListener('change', () => {
  saveSettings();
  restartAutoRefresh();
});

els.autoRefreshToggleBtn.addEventListener('click', () => {
  autoRefreshPaused = !autoRefreshPaused;
  updateAutoRefreshUi();
  saveSettings();
  restartAutoRefresh();
});

document.querySelectorAll('.th-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const field = btn.dataset.sort;
    if (!field) return;
    if (sortBy === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = field;
      sortDirection = field === 'totalProbes' || field === 'uniqueDeviceCount' ? 'desc' : 'asc';
    }
    applySort();
    renderRows(currentRows);
    saveSettings();
  });
});

els.connectBtn.addEventListener('click', async () => {
  saveSettings();
  await handleConnect();
});

els.pullDataBtn.addEventListener('click', async () => {
  await pullData();
});

function renderConnectionState() {
  const connected = connectionState === 'connected';
  const connecting = connectionState === 'connecting';

  els.connectBtn.style.display = connected ? 'none' : '';
  els.connectBtn.disabled = connecting;
  els.connectBtn.textContent = connecting ? 'Connecting…' : 'Connect';

  els.pullDataBtn.style.display = connected ? '' : 'none';
  els.pullDataBtn.disabled = false;
}

async function handleConnect() {
  const settings = getSettings();
  if (!settings.host || !settings.user || !settings.pass) {
    setStatus('Host, username, and password are required.', 'bad');
    document.querySelector('.settings-collapsible').open = true;
    return;
  }

  connectionState = 'connecting';
  renderConnectionState();
  setStatus('Connecting to Kismet…', 'warn');

  try {
    const response = await fetch('/api/kismet/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ host: settings.host, user: settings.user, pass: settings.pass }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      connectionState = 'disconnected';
      renderConnectionState();
      setStatus(`Connection failed: ${payload.error || response.status}`, 'bad');
      return;
    }

    activeConnection = settings;
    connectionState = 'connected';
    renderConnectionState();
    setStatus('Connected to Kismet.', 'ok');
    startHeartbeat();
    restartAutoRefresh();
  } catch (error) {
    connectionState = 'disconnected';
    renderConnectionState();
    setStatus(`Connection error: ${error.message}`, 'bad');
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (!activeConnection) return;
    try {
      const response = await fetch('/api/kismet/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ host: activeConnection.host, user: activeConnection.user, pass: activeConnection.pass }),
      });
      if (!response.ok) throw new Error(`Heartbeat ${response.status}`);
    } catch (error) {
      activeConnection = null;
      connectionState = 'disconnected';
      stopHeartbeat();
      if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
      autoRefreshPaused = true;
      updateAutoRefreshUi();
      renderConnectionState();
      setStatus(`Kismet connection lost: ${error.message}`, 'bad');
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

async function runEnrichLocation() {
  const wigleKey = (activeConnection?.wigleKey || els.wigleKey.value || '').trim();
  if (!wigleKey) {
    setStatus('WiGLE key required for location enrichment. Add it in Connection Settings.', 'bad');
    return;
  }

  const needsEnrichment = currentRows.filter((row) => !hasLocationData(row));
  if (needsEnrichment.length === 0) {
    setStatus('All rows already have location data.', 'ok');
    return;
  }

  els.enrichLocationBtn.disabled = true;
  els.enrichLocationBtn.textContent = 'Enriching…';
  setStatus(`Enriching ${needsEnrichment.length} rows with no location data…`, 'warn');

  cacheHitCount = 0;
  cacheMissCount = 0;
  renderCacheStats();

  const wigleStats = await enrichRowsWithWigle(currentRows, wigleKey);

  saveHistoricalRows(currentRows);
  applySort();
  renderRows(currentRows);
  renderCacheStats();

  els.enrichLocationBtn.disabled = false;
  els.enrichLocationBtn.textContent = 'Enrich Location';

  const errorSuffix = wigleStats.errors?.length ? ` Errors: ${wigleStats.errors.join(' | ')}` : '';
  const commonSuffix = wigleStats.skippedCommon > 0 ? ` ${wigleStats.skippedCommon} common SSIDs skipped.` : '';
  setStatus(
    `Enrichment done. ${wigleStats.success} located, ${wigleStats.failed} failed, ${wigleStats.skippedWithLocation} already had location.${commonSuffix}${errorSuffix}`,
    wigleStats.failed > 0 ? 'warn' : 'ok',
  );
}

async function pullData() {
  if (connectionState !== 'connected' || !activeConnection) {
    setStatus('Not connected. Click Connect first.', 'bad');
    return;
  }
  setBusy(true);
  setStatus('Loading Kismet device records…', 'warn');

  try {
    const settings = {
      ...activeConnection,
      newerThanDate: els.newerThanDate.value,
    };
    const stats = { rows: loadHistoricalRows() };
    setStatus('Loading Kismet device records...', 'warn');

    const deviceRecords = await fetchKismetDeviceRecords(settings);
    renderRawPreview(deviceRecords);
    setStatus(`Loaded ${deviceRecords.length} device records. Parsing advertised SSID map...`, 'warn');
    const mergeStats = mergeDeviceSsidRows(stats.rows, deviceRecords, settings.newerThanDate);
    applyCachedLocations(stats.rows);
    renderEndpointWarning(deviceRecords.length, mergeStats.addedEvents);

    if (deviceRecords.length === 0) {
      setStatus('No device records returned. Check endpoint and auth.', 'bad');
    } else {
      setStatus(`Found ${stats.rows.length} SSIDs. Enriching with WiGLE data...`, 'warn');
    }

    cacheHitCount = 0;
    cacheMissCount = 0;
    renderCacheStats();
    const wigleStats = await enrichRowsWithWigle(stats.rows, settings.wigleKey);

    currentRows = stats.rows;
    saveHistoricalRows(currentRows);
    applySort();
    renderMetrics(currentRows);
    renderRows(currentRows);
    renderCacheStats();
    els.exportCsvBtn.disabled = currentRows.length === 0;
    if (settings.wigleKey) {
      const errorSuffix = wigleStats.errors?.length ? ` Errors: ${wigleStats.errors.join(' | ')}` : '';
      const commonSuffix = wigleStats.skippedCommon > 0 ? ` ${wigleStats.skippedCommon} common/ISP SSIDs skipped.` : '';
      setStatus(
        `Done. WiGLE lookups: ${wigleStats.success}/${wigleStats.attempted} success, ${wigleStats.failed} failed, ${wigleStats.skippedWithLocation} skipped (already had location).${commonSuffix}${errorSuffix}`,
        wigleStats.failed > 0 ? 'warn' : 'ok',
      );
    } else {
      setStatus('Done. (WiGLE auth not provided, location enrichment skipped.)', 'ok');
    }
  } catch (error) {
    console.error(error);
    renderRawPreview([]);
    setStatus(`Error: ${error.message}`, 'bad');
  } finally {
    setBusy(false);
  }
}

function getSettings() {
  return {
    host: els.host.value.trim(),
    user: els.user.value.trim(),
    pass: els.pass.value,
    eventEndpoint: els.eventEndpoint.value.trim(),
    newerThanDate: els.newerThanDate.value,
    autoRefreshInterval: Number(els.autoRefreshInterval.value) || 0,
    wigleKey: els.wigleKey.value.trim(),
  };
}

function saveSettings() {
  const settings = getSettings();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      host: settings.host,
      user: settings.user,
      eventEndpoint: settings.eventEndpoint,
      newerThanDate: settings.newerThanDate || '',
      autoRefreshInterval: settings.autoRefreshInterval,
      autoRefreshPaused,
      sortBy,
      sortDirection,
    }),
  );
}

function loadSettings(yamlDefaults = {}) {
  const raw = localStorage.getItem(STORAGE_KEY);

  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) || {};
    } catch {
      parsed = {};
    }
  }

  els.host.value = parsed.host || yamlDefaults.host || '';
  els.user.value = parsed.user || yamlDefaults.user || '';
  els.pass.value = yamlDefaults.pass || '';
  els.wigleKey.value = yamlDefaults.wigleKey || '';
  els.eventEndpoint.value = parsed.eventEndpoint || yamlDefaults.eventEndpoint || '/devices/views/all/devices.json';
  els.newerThanDate.value = parsed.newerThanDate || '';

  // Map saved interval to valid topbar select values (60/300/900/1800).
  // Old values (0, 10, 30) default to 60.
  const validIntervals = ['60', '300', '900', '1800'];
  const savedInterval = String(parsed.autoRefreshInterval ?? '60');
  els.autoRefreshInterval.value = validIntervals.includes(savedInterval) ? savedInterval : '60';

  autoRefreshPaused = parsed.autoRefreshPaused !== undefined ? Boolean(parsed.autoRefreshPaused) : true;
  if (parsed.sortBy) sortBy = parsed.sortBy;
  if (parsed.sortDirection === 'asc' || parsed.sortDirection === 'desc') sortDirection = parsed.sortDirection;
}

async function fetchYamlDefaults() {
  try {
    const response = await fetch('/api/config/defaults', { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return {};
    return payload.defaults || {};
  } catch {
    return {};
  }
}

function loadHistoricalRows() {
  const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((row) => ({
        ssid: String(row.ssid || '').trim(),
        totalProbes: Number(row.totalProbes) || 0,
        uniqueDeviceCount: Number(row.uniqueDeviceCount) || 0,
        devices: Array.isArray(row.devices) ? row.devices.map((d) => String(d).toUpperCase()) : [],
        firstSeen: Number(row.firstSeen) || 0,
        lastSeen: Number(row.lastSeen) || 0,
        signalDbm: row.signalDbm !== null && row.signalDbm !== undefined ? Number(row.signalDbm) : null,
        address: String(row.address || ''),
        city: String(row.city || ''),
        state: String(row.state || ''),
        lat: row.lat !== null && row.lat !== undefined ? Number(row.lat) : null,
        lng: row.lng !== null && row.lng !== undefined ? Number(row.lng) : null,
      }))
      .filter((row) => row.ssid);
  } catch {
    return [];
  }
}

function saveHistoricalRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => ({
    ssid: row.ssid,
    totalProbes: row.totalProbes || 0,
    uniqueDeviceCount: row.uniqueDeviceCount || 0,
    devices: Array.isArray(row.devices) ? row.devices : [],
    firstSeen: row.firstSeen || 0,
    lastSeen: row.lastSeen || 0,
    signalDbm: row.signalDbm !== undefined ? row.signalDbm : null,
    address: row.address || '',
    city: row.city || '',
    state: row.state || '',
    lat: row.lat !== undefined ? row.lat : null,
    lng: row.lng !== undefined ? row.lng : null,
  }));
  localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(normalized));
}

function setBusy(isBusy) {
  els.pullDataBtn.disabled = isBusy;
  els.clearDateBtn.disabled = isBusy;
  els.exportCsvBtn.disabled = isBusy || currentRows.length === 0;
  els.pullDataBtn.textContent = isBusy ? 'Working…' : 'Pull Data';
}

function setStatus(message, level = '') {
  els.status.className = `status ${level}`.trim();
  els.status.textContent = message;
}

function updateAutoRefreshUi() {
  if (autoRefreshPaused) {
    els.autoRefreshToggleBtn.classList.remove('active');
    els.autoRefreshToggleBtn.title = 'Enable auto-refresh';
  } else {
    els.autoRefreshToggleBtn.classList.add('active');
    els.autoRefreshToggleBtn.title = 'Disable auto-refresh';
  }
}

function restartAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  const sec = Number(els.autoRefreshInterval.value) || 0;
  if (sec <= 0 || autoRefreshPaused || connectionState !== 'connected') return;

  autoRefreshTimer = setInterval(() => {
    if (!els.pullDataBtn.disabled) {
      pullData();
    }
  }, sec * 1000);
}

async function fetchKismetDeviceRecords({ host, user, pass, eventEndpoint }) {
  if (!eventEndpoint) return [];

  const response = await fetch('/api/kismet/fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ host, user, pass, endpoint: eventEndpoint }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('Device endpoint fetch failed:', payload.error || response.status);
    return [];
  }

  return normalizeDeviceRecords(payload?.data);
}

function normalizeDeviceRecords(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  if (typeof data === 'object') {
    if (Array.isArray(data.devices)) return data.devices;
    const nestedArrays = Object.values(data).filter(Array.isArray);
    if (nestedArrays.length > 0) return nestedArrays.flat();
    return [data];
  }

  return [];
}

function mergeDeviceSsidRows(rows, deviceRecords, newerThanDate) {
  if (!Array.isArray(deviceRecords) || deviceRecords.length === 0) return { addedEvents: 0 };

  const seen = loadSeenEventKeys();
  const rowBySsid = new Map(rows.map((row) => [row.ssid, row]));
  const devicesBySsid = new Map(
    rows.map((row) => [row.ssid, new Set((row.devices || []).map((mac) => String(mac).toUpperCase()))]),
  );

  const cutoffSec = getDateCutoffSeconds(newerThanDate);
  let addedEvents = 0;

  for (const device of deviceRecords) {
    const ts = extractRecordTimestamp(device);
    if (Number.isFinite(cutoffSec) && Number.isFinite(ts) && ts < cutoffSec) continue;

    const mac = extractDeviceMac(device);
    const advertised = extractAdvertisedSsidMap(device);
    for (const entry of advertised) {
      const ssid = entry.ssid;
      const count = entry.count;
      const eventTs = Number.isFinite(ts) ? Math.floor(ts) : 0;
      const dedupeKey = `${eventTs}|${mac}|${ssid}|${count}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const signalDbm = extractDeviceSignal(device);

      let row = rowBySsid.get(ssid);
      if (!row) {
        row = {
          ssid,
          totalProbes: 0,
          uniqueDeviceCount: 0,
          devices: [],
          firstSeen: 0,
          lastSeen: 0,
          signalDbm: null,
          address: '',
          city: '',
          state: '',
          lat: null,
          lng: null,
        };
        rows.push(row);
        rowBySsid.set(ssid, row);
        devicesBySsid.set(ssid, new Set());
      }

      row.totalProbes += count;
      addedEvents += count;
      if (eventTs > 0) {
        if (!row.firstSeen || eventTs < row.firstSeen) row.firstSeen = eventTs;
        if (!row.lastSeen || eventTs > row.lastSeen) row.lastSeen = eventTs;
      }

      // Keep the strongest signal seen for this SSID across all advertising devices
      if (signalDbm !== null && (row.signalDbm === null || signalDbm > row.signalDbm)) {
        row.signalDbm = signalDbm;
      }

      if (mac) {
        const set = devicesBySsid.get(ssid);
        set.add(mac);
        row.devices = [...set].sort();
        row.uniqueDeviceCount = set.size;
      }
    }
  }

  saveSeenEventKeys(seen);
  return { addedEvents };
}

function extractDeviceSignal(device) {
  const sig = getNestedValue(device, 'kismet.device.base.signal');
  if (!sig || typeof sig !== 'object') return null;
  // Prefer last_signal; fall back to max_signal if last is 0 (not yet measured)
  const last = Number(sig['kismet.common.signal.last_signal']);
  if (Number.isFinite(last) && last !== 0) return last;
  const max = Number(sig['kismet.common.signal.max_signal']);
  if (Number.isFinite(max) && max !== 0) return max;
  return null;
}

function extractAdvertisedSsidMap(device) {
  // Kismet flattens the requested path dot11.device/dot11.device.advertised_ssid_map
  // into the response key dot11.device.advertised_ssid_map (drops the dot11.device/ prefix).
  // Value of 0 means no advertised SSIDs (client device, not an AP) — handled below.
  const value =
    getNestedValue(device, 'dot11.device.advertised_ssid_map') ||
    // Fallback: in case Kismet returns the full request path as-is
    getNestedValue(device, 'dot11.device/dot11.device.advertised_ssid_map') ||
    {};

  if (!value || typeof value !== 'object') return [];

  const out = [];
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object') {
      // Real Kismet advertised SSID map entries use dot11.advertisedssid.* keys
      const ssid = String(
        item['dot11.advertisedssid.ssid'] ||
        item['dot11.advertised_ssid.ssid'] ||
        item.ssid ||
        key ||
        ''
      ).trim();
      const count = Number(
        item['dot11.advertisedssid.count'] ||
        item['dot11.advertised_ssid.count'] ||
        item.count ||
        1
      );
      if (ssid && ssid !== '0') out.push({ ssid, count: Number.isFinite(count) && count > 0 ? count : 1 });
    } else if (typeof key === 'string' && key.trim() && key.trim() !== '0') {
      const count = Number(item || 1);
      out.push({ ssid: key.trim(), count: Number.isFinite(count) && count > 0 ? count : 1 });
    }
  }
  return out;
}

function extractDeviceMac(device) {
  const keys = ['kismet.device.base.macaddr', 'dot11.device/dot11.device.last_bssid', 'kismet.device.base.key'];
  for (const key of keys) {
    const value = getNestedValue(device, key);
    if (typeof value === 'string' && value.trim()) return value.toUpperCase();
  }
  return '';
}

function getDateCutoffSeconds(newerThanDate) {
  if (!newerThanDate) return Number.NaN;
  const cutoffMs = new Date(`${newerThanDate}T00:00:00`).getTime();
  if (!Number.isFinite(cutoffMs)) return Number.NaN;
  return Math.floor(cutoffMs / 1000);
}

function extractRecordTimestamp(record) {
  const candidates = [
    'kismet.device.base.last_time',
    'kismet.device.base.first_time',
    'kismet.device.base.mod_time',
    'kismet.messagebus.message_time',
    'kismet.messagebus.timestamp',
    'kismet.alert.timestamp',
    'timestamp',
    'ts',
    'time',
  ];

  for (const key of candidates) {
    const value = getNestedValue(record, key);
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return Number.NaN;
}

function loadSeenEventKeys() {
  const raw = localStorage.getItem(SEEN_EVENTS_STORAGE_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function saveSeenEventKeys(set) {
  const arr = [...set];
  const trimmed = arr.length > MAX_SEEN_EVENT_KEYS ? arr.slice(arr.length - MAX_SEEN_EVENT_KEYS) : arr;
  localStorage.setItem(SEEN_EVENTS_STORAGE_KEY, JSON.stringify(trimmed));
}





function getFilteredRows() {
  let rows = currentRows;

  if (!displayCommonSsid) {
    rows = rows.filter((row) => !isCommonSsid(row.ssid));
  }

  if (!filterQuery) return rows;
  return rows.filter((row) => (
    row.ssid.toLowerCase().includes(filterQuery) ||
    (row.address || '').toLowerCase().includes(filterQuery) ||
    (row.city || '').toLowerCase().includes(filterQuery) ||
    (row.state || '').toLowerCase().includes(filterQuery) ||
    (row.devices || []).some((mac) => mac.toLowerCase().includes(filterQuery))
  ));
}

function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];

  const segments = path.split(/[./]/g);
  let current = obj;
  for (const segment of segments) {
    if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

function normalizeSsidKey(ssid) {
  return String(ssid || '').trim().toLowerCase();
}

function hasLocationData(row) {
  return Boolean((row.address || '').trim() || (row.city || '').trim() || (row.state || '').trim());
}

function applyCachedLocations(rows) {
  for (const row of rows) {
    if (hasLocationData(row)) continue;
    const cached = ssidLocationCache.get(normalizeSsidKey(row.ssid));
    if (!cached) continue;
    row.address = cached.address || '';
    row.city = cached.city || '';
    row.state = cached.state || '';
    row.lat = cached.lat ?? null;
    row.lng = cached.lng ?? null;
  }
}

async function enrichRowsWithWigle(rows, wigleKey) {
  if (!wigleKey) return { attempted: 0, success: 0, failed: 0, skippedWithLocation: 0, skippedCommon: 0, firstError: '', errors: [] };

  const stats = { attempted: 0, success: 0, failed: 0, skippedWithLocation: 0, skippedCommon: 0, firstError: '', errors: [] };
  const maxLookups = Math.min(rows.length, 100);
  for (let i = 0; i < maxLookups; i += 1) {
    const row = rows[i];

    if (hasLocationData(row)) {
      stats.skippedWithLocation += 1;
      continue;
    }

    stats.attempted += 1;
    try {
      const info = await lookupSsidInWigle(row.ssid, wigleKey);

      if (info.skipped) {
        stats.skippedCommon += 1;
        stats.attempted -= 1; // don't count skipped as attempted
        continue;
      }

      row.address = info.address;
      row.city = info.city;
      row.state = info.state;
      row.lat = info.lat ?? null;
      row.lng = info.lng ?? null;
      if (hasLocationData(row)) {
        ssidLocationCache.set(normalizeSsidKey(row.ssid), {
          address: row.address,
          city: row.city,
          state: row.state,
          lat: row.lat,
          lng: row.lng,
        });
      }
      if (info.cached) cacheHitCount += 1;
      else cacheMissCount += 1;
      stats.success += 1;
      renderCacheStats();
    } catch (error) {
      stats.failed += 1;
      const msg = error?.message || 'Unknown WiGLE error';
      if (!stats.firstError) stats.firstError = msg;
      if (stats.errors.length < 3) stats.errors.push(`${row.ssid}: ${msg}`);
      console.warn(`WiGLE lookup failed for ${row.ssid}:`, error);
    }
  }

  return stats;
}

async function lookupSsidInWigle(ssid, wigleKey) {
  const response = await fetch('/api/wigle/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ ssid, wigleKey }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `WiGLE request failed (${response.status})`);
  }

  return {
    address: payload.address || '',
    city: payload.city || '',
    state: payload.state || '',
    lat: payload.lat !== undefined && payload.lat !== null ? Number(payload.lat) : null,
    lng: payload.lng !== undefined && payload.lng !== null ? Number(payload.lng) : null,
    cached: Boolean(payload.cached),
    skipped: Boolean(payload.skipped),
  };
}

function renderRawPreview(records) {
  const list = Array.isArray(records) ? records : [];
  const shown = list.slice(0, 3);
  els.rawPreviewMeta.textContent = `${shown.length}/${list.length} shown`;

  if (list.length === 0) {
    els.rawPreview.textContent = 'No records returned by device endpoint.';
    return;
  }

  els.rawPreview.textContent = JSON.stringify(shown, null, 2);
}

function renderEndpointWarning(recordCount, addedEvents) {
  if (!els.endpointWarning) return;
  if (recordCount > 0 && addedEvents === 0) {
    els.endpointWarning.style.display = 'block';
    els.endpointWarning.textContent =
      'Endpoint returned records, but no entries were found in dot11.device.advertised_ssid_map.';
  } else {
    els.endpointWarning.style.display = 'none';
    els.endpointWarning.textContent = '';
  }
}

function renderCacheStats() {
  const total = cacheHitCount + cacheMissCount;
  els.cacheStats.className = 'cache-stats';

  if (total === 0) {
    els.cacheStats.textContent = 'Cache: n/a';
    return;
  }

  const pct = Math.round((cacheHitCount / total) * 100);
  if (pct >= 70) els.cacheStats.classList.add('good');
  else if (pct >= 40) els.cacheStats.classList.add('ok');
  else els.cacheStats.classList.add('bad');

  els.cacheStats.textContent = `Cache: ${cacheHitCount} hits / ${cacheMissCount} misses (${pct}% hit rate)`;
}

function applySort() {
  const direction = sortDirection === 'asc' ? 1 : -1;
  currentRows.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';

    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * direction;
    }

    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * direction;
  });
}

function renderMetrics(rows) {
  const totalSsids = rows.length;
  const duplicates = rows.filter((row) => row.uniqueDeviceCount > 1).length;
  const states = new Set(rows.map((row) => row.state).filter(Boolean)).size;

  els.metricTotalSsids.textContent = totalSsids.toLocaleString();
  els.metricDuplicates.textContent = duplicates.toLocaleString();
  els.metricStates.textContent = states.toLocaleString();
}

function renderRows(_rows) {
  const rows = getFilteredRows();
  const total = currentRows.length;

  if (filterQuery) {
    els.filterCount.textContent = `${rows.length} of ${total}`;
  } else {
    els.filterCount.textContent = total > 0 ? `${total} total` : '';
  }

  if (!rows.length) {
    els.resultsBody.innerHTML = filterQuery
      ? `<tr class="empty-row"><td colspan="11">No results match "${escapeHtml(filterQuery)}".</td></tr>`
      : `<tr class="empty-row"><td colspan="11">No advertised SSID results yet.</td></tr>`;
    return;
  }

  els.resultsBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.ssid)}</td>
        <td>${row.totalProbes.toLocaleString()}</td>
        <td>${row.uniqueDeviceCount.toLocaleString()}</td>
        <td>${escapeHtml((row.devices || []).join(', ') || '-')}</td>
        <td>${escapeHtml(formatTimestamp(row.firstSeen))}</td>
        <td>${escapeHtml(formatTimestamp(row.lastSeen))}</td>
        <td>${signalBarsHtml(row.signalDbm)}</td>
        <td>${escapeHtml(row.address || '-')}</td>
        <td>${escapeHtml(row.city || '-')}</td>
        <td>${escapeHtml(row.state || '-')}</td>
        <td>${formatLatLng(row.lat, row.lng)}</td>
      </tr>`,
    )
    .join('');
}

function exportCsv(rows) {
  if (!rows.length) return;
  const header = [
    'SSID',
    'total_advertisements',
    'unique_devices',
    'devices_macs',
    'first_seen_epoch',
    'last_seen_epoch',
    'signal_dbm',
    'most_likely_address',
    'most_likely_city',
    'most_likely_state',
    'lat',
    'lng',
  ];
  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(
      [
        csv(row.ssid),
        row.totalProbes,
        row.uniqueDeviceCount,
        csv((row.devices || []).join(' ')),
        row.firstSeen || '',
        row.lastSeen || '',
        row.signalDbm !== null && row.signalDbm !== undefined ? row.signalDbm : '',
        csv(row.address || ''),
        csv(row.city || ''),
        csv(row.state || ''),
        row.lat !== null && row.lat !== undefined ? row.lat : '',
        row.lng !== null && row.lng !== undefined ? row.lng : '',
      ].join(','),
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kismet_advertised_ssid_summary_${new Date().toISOString().replaceAll(':', '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function signalBarsHtml(dbm) {
  if (dbm === null || dbm === undefined || !Number.isFinite(Number(dbm))) {
    return `<span class="signal-bars" title="No signal data">
      <span class="bar b1"></span><span class="bar b2"></span>
      <span class="bar b3"></span><span class="bar b4"></span>
    </span>`;
  }
  const v = Number(dbm);
  const tier = v > -60 ? 4 : v > -70 ? 3 : v > -80 ? 2 : v > -90 ? 1 : 0;
  const label = tier === 0 ? 'Very weak' : tier === 1 ? 'Weak' : tier === 2 ? 'Fair' : tier === 3 ? 'Good' : 'Excellent';
  const cls = tier > 0 ? `bars-${tier}` : '';
  return `<span class="signal-bars ${cls}" title="${v} dBm — ${label}">
    <span class="bar b1"></span><span class="bar b2"></span>
    <span class="bar b3"></span><span class="bar b4"></span>
  </span>`;
}

function formatCoord(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Number(value).toFixed(6);
}

function formatLatLng(lat, lng) {
  const la = formatCoord(lat);
  const lo = formatCoord(lng);
  if (!la || !lo) return '-';
  const coords = `${la}, ${lo}`;
  return `<span class="coord-cell">
    <span class="coord-value">${escapeHtml(coords)}</span>
    <button class="copy-coord-btn" data-coords="${escapeHtml(coords)}" title="Copy coordinates" type="button">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
        <path d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
    </button>
  </span>`;
}


function formatTimestamp(epochSeconds) {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return new Date(n * 1000).toLocaleString();
}

function csv(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
