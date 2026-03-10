# ICEphisher (Electron App)

Desktop app for:
- Connecting to a Kismet instance over HTTP Basic Auth
- Pulling long-term device records from `/devices/views/all/devices.json`
- Parsing `dot11.device.advertised_ssid_map` per device
- Tracking cumulative SSID history with deduplication
- Tracking per-SSID MACs, first seen, and last seen
- Optional WiGLE enrichment (skip if location already known)
- CSV export + raw endpoint preview + auto-refresh controls

## Run

### Electron app (default)

```bash
cd kismet-probe-spa
npm install
npm start
```

### Web-only dev mode

```bash
cd kismet-probe-spa
npm run dev:web
# Open http://localhost:8787
```

### Mock Kismet (Docker test backend)

```bash
cd kismet-probe-spa/mock-kismet
docker build -t mock-kismet:latest .
docker run --rm -p 2501:2501 mock-kismet:latest
```

## Inputs

- **Kismet Host/IP**: e.g. `192.168.1.50:2501` or `http://192.168.1.50:2501`
- **Kismet Username / Password**: HTTP basic auth credentials
- **Kismet Device Endpoint**: defaults to `/devices/views/all/devices.json`
- **WiGLE Auth (optional)**:
  - Preferred: `apiName:apiToken` (from your WiGLE account/API page)
  - Also accepts: `Basic <base64...>`
  - Legacy fallback: single value treated as `<value>:`

## YAML Defaults

Populate `icephisher.defaults.yaml` (or `config.yaml`) in the app directory to prefill:

- `host`
- `user`
- `pass`
- `eventEndpoint`
- `wigleKey`

These are loaded automatically on app startup.

## Notes

1. In Electron mode, the local server starts automatically on a random localhost port.
2. Kismet and WiGLE calls are proxied through local endpoints:
   - `POST /api/kismet/fetch`
   - `POST /api/wigle/lookup`
3. SSID extraction reads `dot11.device.advertised_ssid_map` from device records.
4. WiGLE lookups are capped (top 100 per refresh) and cached server-side for 24 hours.

## Security

- Secrets are sent from browser → local server at runtime and are **not** persisted in localStorage.
- Only host/username/endpoint are stored locally for convenience.
- Keep this service bound to localhost (default) unless you intentionally front it with auth/TLS.
