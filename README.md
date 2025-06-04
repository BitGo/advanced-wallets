# Enclaved Express

Enclaved Express is a secure signer implementation for cryptocurrency operations. It's designed to run in a secure enclave environment with mTLS security.

## Overview

This module provides a lightweight, dedicated signing server with these features:

- Focused on signing operations only - no BitGo API dependencies
- mTLS security for secure connections with client certificate validation
- Simple configuration and deployment

## Supported Operations

Currently, the following operations are supported:

- `/ping` - Health check endpoint

## Configuration

Configuration is done via environment variables:

### Required Settings

- `APP_MODE` - Application mode (required, must be either "enclaved" or "master-express")

### Network Settings

#### Enclaved Mode

- `ENCLAVED_EXPRESS_PORT` - Port to listen on (default: 3080)
- `MASTER_BITGO_EXPRESS_BIND` - Address to bind to (default: localhost)
- `MASTER_BITGO_EXPRESS_TIMEOUT` - Request timeout in milliseconds (default: 305000)

#### Master Express Mode

- `MASTER_EXPRESS_PORT` - Port to listen on (default: 3081)
- `BITGO_BIND` - Address to bind to (default: localhost)
- `BITGO_TIMEOUT` - Request timeout in milliseconds (default: 305000)

### mTLS Settings

#### Enclaved Mode

- `MASTER_BITGO_EXPRESS_KEYPATH` - Path to server key file (required)
- `MASTER_BITGO_EXPRESS_CRTPATH` - Path to server certificate file (required)
- `MASTER_BITGO_EXPRESS_TLS_KEY` - Server key content (alternative to keyPath)
- `MASTER_BITGO_EXPRESS_TLS_CERT` - Server certificate content (alternative to crtPath)
- `MTLS_REQUEST_CERT` - Whether to request client certificates (default: true)
- `MTLS_REJECT_UNAUTHORIZED` - Whether to reject unauthorized connections (default: true)
- `MTLS_ALLOWED_CLIENT_FINGERPRINTS` - Comma-separated list of allowed client certificate fingerprints (optional)
- `MASTER_BITGO_EXPRESS_DISABLE_TLS` - Disable TLS completely (default: false)

#### Master Express Mode

- `BITGO_KEYPATH` - Path to server key file (required)
- `BITGO_CRTPATH` - Path to server certificate file (required)
- `BITGO_TLS_KEY` - Server key content (alternative to keyPath)
- `BITGO_TLS_CERT` - Server certificate content (alternative to crtPath)
- `MTLS_REQUEST_CERT` - Whether to request client certificates (default: true)
- `MTLS_REJECT_UNAUTHORIZED` - Whether to reject unauthorized connections (default: true)
- `MTLS_ALLOWED_CLIENT_FINGERPRINTS` - Comma-separated list of allowed client certificate fingerprints (optional)
- `MASTER_BITGO_EXPRESS_DISABLE_TLS` - Disable TLS completely (default: false)

### Master Express Settings

- `BITGO_ENV` - Environment name (default: test)
- `BITGO_DISABLE_ENV_CHECK` - Disable environment check (default: true)
- `BITGO_AUTH_VERSION` - Authentication version (default: 2)
- `ENCLAVED_EXPRESS_URL` - URL of the enclaved express server (required)
- `ENCLAVED_EXPRESS_SSL_CERT` - Path to the enclaved express server's SSL certificate (required)
- `BITGO_CUSTOM_ROOT_URI` - Custom root URI for BitGo API
- `BITGO_CUSTOM_BITCOIN_NETWORK` - Custom Bitcoin network

### Other Settings

- `LOGFILE` - Path to log file (optional)
- `DEBUG` - Debug namespaces to enable (e.g., 'enclaved:\*')

## Running Enclaved Express

### Basic Setup (mTLS)

```bash
APP_MODE=enclaved \
ENCLAVED_EXPRESS_PORT=3080 \
MASTER_BITGO_EXPRESS_BIND=localhost \
MASTER_BITGO_EXPRESS_KEYPATH=./test-ssl-key.pem \
MASTER_BITGO_EXPRESS_CRTPATH=./test-ssl-cert.pem \
MTLS_REQUEST_CERT=true \
MTLS_REJECT_UNAUTHORIZED=true \
yarn start
```

### Connecting from Master Express

To connect to Enclaved Express from the Master Express server:

```bash
APP_MODE=master-express \
MASTER_EXPRESS_PORT=3081 \
BITGO_BIND=localhost \
BITGO_ENV=test \
BITGO_KEYPATH=./test-ssl-key.pem \
BITGO_CRTPATH=./test-ssl-cert.pem \
ENCLAVED_EXPRESS_URL=https://localhost:3080 \
ENCLAVED_EXPRESS_SSL_CERT=./enclaved-express-cert.pem \
yarn start
```

## Understanding mTLS Configuration

### Server Side (Enclaved Express)

- Uses both certificate and key files
- The key file (`test-ssl-key.pem`) is used to prove the server's identity
- The certificate file (`test-ssl-cert.pem`) is what the server presents to clients
- Client certificates are required by default
- Unauthorized connections are rejected by default

### Client Side (Master Express)

- Must provide a valid client certificate
- Server certificate must be trusted
- Client certificate must be in the allowed fingerprints list (if specified)

## Security Considerations

- Always use proper CA-signed certificates in production
- Keep private keys secure
- Regularly rotate certificates
- Use client certificate allowlisting
- Enable strict certificate verification
- Never disable TLS in production

## Troubleshooting

### Common Issues

1. **Certificate Errors**

   - Ensure paths to certificate files are correct
   - Check file permissions on certificate files
   - Verify certificate format is correct
   - Check that client certificates are valid and trusted

2. **Connection Issues**

   - Verify ports are not in use
   - Check firewall settings
   - Ensure URLs are correct (including https:// prefix)
   - Verify client certificates are properly configured

3. **mTLS Errors**
   - Verify client certificates are valid
   - Check certificate configuration
   - Ensure client certificate is trusted by server
   - Check that client certificate fingerprint is in allowlist (if specified)

## License

MIT
