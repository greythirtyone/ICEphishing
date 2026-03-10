import express from 'express';

const app = express();
const port = process.env.PORT || 2501;

app.use(express.json());

// Real Kismet structure: devices endpoint returns an array of device objects.
// Field-restricted POST returns only the requested fields as flat keys.
// kismet.device.base.macaddr — MAC address of the device
// dot11.device/dot11.device.advertised_ssid_map — map of advertised SSID entries keyed by SSID hash
//   Each entry: { "dot11.advertisedssid.ssid": "...", "dot11.advertisedssid.count": N }
const devices = [
  {
    'kismet.device.base.macaddr': 'AA:BB:CC:DD:EE:01',
    'kismet.device.base.last_time': 1772870000,
    'kismet.device.base.signal': {
      'kismet.common.signal.last_signal': -62,
      'kismet.common.signal.max_signal': -58,
      'kismet.common.signal.min_signal': -75,
    },
    'dot11.device.advertised_ssid_map': {
      '1111111111': {
        'dot11.advertisedssid.ssid': 'StarbucksWiFi',
        'dot11.advertisedssid.count': 12,
      },
      '2222222222': {
        'dot11.advertisedssid.ssid': 'MyHomeWiFi',
        'dot11.advertisedssid.count': 5,
      },
    },
  },
  {
    'kismet.device.base.macaddr': 'AA:BB:CC:DD:EE:02',
    'kismet.device.base.last_time': 1772956400,
    'kismet.device.base.signal': {
      'kismet.common.signal.last_signal': -78,
      'kismet.common.signal.max_signal': -71,
      'kismet.common.signal.min_signal': -85,
    },
    'dot11.device.advertised_ssid_map': {
      '3333333333': {
        'dot11.advertisedssid.ssid': 'CoffeeHouse',
        'dot11.advertisedssid.count': 4,
      },
      '4444444444': {
        'dot11.advertisedssid.ssid': 'Airport_Free_WiFi',
        'dot11.advertisedssid.count': 3,
      },
    },
  },
  {
    'kismet.device.base.macaddr': 'AA:BB:CC:DD:EE:03',
    'kismet.device.base.last_time': 1773042800,
    'kismet.device.base.signal': {
      'kismet.common.signal.last_signal': -55,
      'kismet.common.signal.max_signal': -50,
      'kismet.common.signal.min_signal': -68,
    },
    'dot11.device.advertised_ssid_map': {
      '2222222222': {
        'dot11.advertisedssid.ssid': 'MyHomeWiFi',
        'dot11.advertisedssid.count': 2,
      },
      '5555555555': {
        'dot11.advertisedssid.ssid': 'LibraryGuest',
        'dot11.advertisedssid.count': 6,
      },
    },
  },
  {
    'kismet.device.base.macaddr': 'AA:BB:CC:DD:EE:04',
    'kismet.device.base.last_time': 1773129200,
    'kismet.device.base.signal': {
      'kismet.common.signal.last_signal': -88,
      'kismet.common.signal.max_signal': -83,
      'kismet.common.signal.min_signal': -92,
    },
    'dot11.device.advertised_ssid_map': {
      '6666666666': {
        'dot11.advertisedssid.ssid': 'Hotel WiFi',
        'dot11.advertisedssid.count': 8,
      },
      '4444444444': {
        'dot11.advertisedssid.ssid': 'Airport_Free_WiFi',
        'dot11.advertisedssid.count': 1,
      },
    },
  },
];

// Real Kismet accepts POST with optional { fields: [...] } body to restrict output fields.
// GET is also supported (returns all fields).
function handleDevicesRequest(req, res) {
  res.json(devices);
}

app.get('/devices/views/all/devices.json', handleDevicesRequest);
app.post('/devices/views/all/devices.json', handleDevicesRequest);

app.get('/devices/last-time/5/devices.json', (_req, res) => {
  res.json(devices.slice(0, 2));
});
app.post('/devices/last-time/5/devices.json', (_req, res) => {
  res.json(devices.slice(0, 2));
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`mock-kismet listening on http://0.0.0.0:${port}`);
});
