# mock-kismet (Docker)

Tiny containerized fake Kismet API for testing `kismet-probe-spa`.

## Build

```bash
cd mock-kismet
docker build -t mock-kismet:latest .
```

## Run

```bash
docker run --rm -p 2501:2501 mock-kismet:latest
```

## Endpoints

- `GET /devices/views/all/devices.json` (primary endpoint used by the app)
  - includes per-device timestamps via `kismet.device.base.last_time` and `mock_date_iso`
- `GET /devices/all_devices.ekjson`
- `GET /devices/last-time/5/devices.json`
- `GET /healthz`

## Use with the app

In `kismet-probe-spa`, set:

- **Kismet Host/IP:** `127.0.0.1:2501`
- **Kismet Username:** any value (mock ignores auth)
- **Kismet Password:** any value (mock ignores auth)
- **Kismet Endpoint:** `/devices/views/all/devices.json`
