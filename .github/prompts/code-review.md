## Task

Review this pull request thoroughly. Cover:

### Correctness & Logic

- Control flow, edge cases, and error propagation across both `advanced-wallet-manager`
  and `master-express` modes
- mTLS certificate loading, validation, and fingerprint-checking paths
- Key generation and signing correctness — no silent failures or swallowed errors

### Cryptographic & Key Management Safety

- **Never approve code that logs, serializes, or transmits private key material,
  mnemonics, or key shares in plaintext** — flag as Critical
- MPC/DKG/DSG round sequencing: ensure protocol state machines advance in the correct
  order and cannot be replayed or skipped
- EdDSA and ECDSA signing paths: verify that the correct key share type is used and
  that partial signatures are assembled correctly
- Recovery paths: confirm that recovery operations use backup key material correctly
  and do not weaken the key custody model

### Resiliency & External I/O

- Key-provider client calls are treated as unreliable: timeouts, retries, and response
  validation must be present
- HTTP/mTLS connections to the Advanced Wallet Manager from Master Express: verify
  error handling for network failures and unexpected status codes
- No floats for coin amounts — all monetary/crypto math must use BigNumber, BigInt,
  or string arithmetic

### Security

- Input validation on all route handlers (`ValidationError` for bad input, not 500s)
- No injection vectors (path traversal, command injection, prototype pollution)
- Certificate paths and environment variables sourced only from trusted config, not
  request data
- Secrets and credentials are never written to logs

### API & Contract

- Public endpoint behavior changes are backwards-compatible or explicitly documented
  as breaking
- Response shapes conform to the `error` / `details` error format
- Route params (`:coin`, `:walletId`, `:txRequestId`, `:shareType`) are validated
  before use

### Test Coverage

- Changed signing/key-management paths have unit tests covering happy path, error
  paths, and protocol edge cases
- mTLS config changes are covered by integration-test scenarios where applicable

### General

- TypeScript strictness — no unsafe `any` casts or missing null checks in hot paths
- Logging is meaningful and does not leak sensitive payload data

## Context

- Repository: ${{ github.repository }}
- PR/Issue: ${{ github.event.issue.number || github.event.pull_request.number }}
- This is a cryptographic signing server. Treat correctness and key-safety findings
  with maximum scrutiny — a bug here can result in loss of customer funds.
