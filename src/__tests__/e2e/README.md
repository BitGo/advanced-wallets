# AKM-OSO E2E Test Suite

End-to-end tests that drive the **full AKM-OSO pipeline** through real services and a real BitGo WP testnet.

Unlike the integration suite (`src/__tests__/integration/`, which boots **mock** servers in-process), this suite points at **already-running** services and verifies results on **testnet**.

## What needs to be running

The suite expects the local docker-compose env to be up (MBE, bridge, FE/BE plugins, mock conductor, AWM user+backup, mock key provider). Bring it up first, then run the suite against it. The signing/keygen/recovery scenarios additionally talk to WP testnet over the internet.

## Configuration

All config comes from the environment (defaults target local compose). See [`helpers/config.ts`](./helpers/config.ts).

| Env var | Default | Purpose |
| --- | --- | --- |
| `E2E_MBE_URL` | `http://localhost:3081` | Master BitGo Express (submit/poll) |
| `E2E_BRIDGE_URL` | `http://localhost:3082` | OSO bridge (resilience scenarios) |
| `E2E_FE_PLUGIN_URL` | `http://localhost:4001` | Frontend plugin |
| `E2E_BE_PLUGIN_URL` | `http://localhost:4002` | Backend plugin |
| `E2E_AWM_URL` | `http://localhost:3080` | AWM (user key) |
| `E2E_AWM_BACKUP_URL` | `http://localhost:3083` | AWM (backup key) |
| `E2E_KEY_PROVIDER_URL` | `http://localhost:3000` | Mock key provider |
| `E2E_COIN` | `tbtc` | Coin under test |
| `E2E_BITGO_ENV` | `test` | BitGo env for testnet verification |
| `BITGO_ACCESS_TOKEN` | — | **Required** for testnet scenarios |
| `E2E_ENTERPRISE` | — | Enterprise id (keygen) |
| `E2E_WALLET_ID` | — | Pre-funded wallet id (signing) |
| `E2E_WALLET_PASSPHRASE` | — | Passphrase for the wallet |
| `E2E_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout |
| `E2E_POLL_INTERVAL_MS` | `2000` | Delay between job polls |
| `E2E_POLL_TIMEOUT_MS` | `180000` | Budget for a job to reach terminal state |

## Running

```bash
npm run test:e2e            # full suite
npm run test:e2e:signing    # signing scenarios only
npm run test:e2e:keygen     # keygen scenarios only
```

The suite uses `.mocharc.e2e.js` + `tsconfig.e2e.json`. Scenario specs are named `*.e2e.test.ts` and are **excluded from `npm test`** (they require live services). Helper unit tests (`*.test.ts`, e.g. `helpers/pollJob.test.ts`) run under `npm test` as usual.

With no services up, `npm run test:e2e` still runs the harness sanity check (`harness.e2e.test.ts`), which only validates config/runner wiring.

## Helpers

- [`config.ts`](./helpers/config.ts) — env-driven config; `loadE2EConfig()` and `requireConfig(cfg, keys)` (call the latter from a scenario `before()` hook).
- [`httpClient.ts`](./helpers/httpClient.ts) — `request()` returns `{ status, body }` for any response (assert on status codes); `authHeaders(token)`.
- [`pollJob.ts`](./helpers/pollJob.ts) — `pollUntil(fn, done, opts)` and `pollJobToTerminal(cfg, jobId)` (polls MBE until `complete`/`failed`).
- [`testnet.ts`](./helpers/testnet.ts) — `getBitGo()`, `getWallet()`, `getWalletKeychainPubs()`, `getTransfer()` for WP testnet verification.

## Logs

Service logs come from the compose env: `docker compose logs -f <service>`.
