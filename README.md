# Enclaved Express

Enclaved Express is a secure signer implementation for cryptocurrency operations. It's designed to run in a secure enclave environment with flexible security options.

## Overview

This module provides a lightweight, dedicated signing server with these features:

- Focused on signing operations only - no BitGo API dependencies
- Optional TLS security for secure connections
- Client certificate validation when operating in mTLS mode
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

### TLS Settings

- `MASTER_BITGO_EXPRESS_KEYPATH` - Path to server key file (required for TLS)
- `MASTER_BITGO_EXPRESS_CRTPATH` - Path to server certificate file (required for TLS)
- `MTLS_ENABLED` - Enable mTLS mode (default: false)
- `MTLS_REQUEST_CERT` - Whether to request client certificates (default: false)
- `MTLS_REJECT_UNAUTHORIZED` - Whether to reject unauthorized connections (default: false)
- `MTLS_ALLOWED_CLIENT_FINGERPRINTS` - Comma-separated list of allowed client certificate fingerprints (optional)

### Master Express Settings

- `BITGO_ENV` - Environment name (default: test)
- `BITGO_ENABLE_SSL` - Enable SSL and certificate verification (default: true)
- `BITGO_ENABLE_PROXY` - Enable proxy (default: true)
- `ENCLAVED_EXPRESS_URL` - URL of the enclaved express server (required)
- `ENCLAVED_EXPRESS_SSL_CERT` - Path to the enclaved express server's SSL certificate (required)

### Other Settings

- `LOGFILE` - Path to log file (optional)
- `DEBUG` - Debug namespaces to enable (e.g., 'enclaved:\*')

## Running Enclaved Express

### Basic Setup (HTTP only)

```bash
yarn start --port 3080
```

### TLS Setup (with mTLS)

For testing purposes, you can use self-signed certificates with relaxed verification:

```bash
APP_MODE=enclaved \
ENCLAVED_EXPRESS_PORT=3080 \
MASTER_BITGO_EXPRESS_BIND=localhost \
MASTER_BITGO_EXPRESS_KEYPATH=./test-ssl-key.pem \
MASTER_BITGO_EXPRESS_CRTPATH=./test-ssl-cert.pem \
MTLS_ENABLED=true \
MTLS_REQUEST_CERT=true \
MTLS_REJECT_UNAUTHORIZED=false \
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
BITGO_ENABLE_SSL=false \
yarn start
```

## Understanding mTLS Configuration

### Server Side (Enclaved Express)

- Uses both certificate and key files
- The key file (`test-ssl-key.pem`) is used to prove the server's identity
- The certificate file (`test-ssl-cert.pem`) is what the server presents to clients

### Client Side (Regular Express)

- For testing, only needs the server's certificate
- `rejectUnauthorized: false` allows testing without strict certificate verification
- In production, proper client certificates should be used

## Security Considerations

- The testing configuration (`MTLS_REJECT_UNAUTHORIZED=false`) should only be used in development
- In production:
  - Use proper CA-signed certificates
  - Enable strict certificate verification
  - Use client certificate allowlisting
  - Keep private keys secure
  - Regularly rotate certificates

## Troubleshooting

### Common Issues

1. **Certificate Errors**

   - Ensure paths to certificate files are correct
   - Check file permissions on certificate files
   - Verify certificate format is correct

2. **Connection Issues**

   - Verify ports are not in use
   - Check firewall settings
   - Ensure URLs are correct (including https:// prefix)

3. **mTLS Errors**
   - Verify mTLS is enabled on both sides
   - Check certificate configuration
   - Ensure client certificate is trusted by server

## License

MIT
