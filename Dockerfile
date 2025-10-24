# syntax=docker/dockerfile:1.4

# Build stage
# Using node:22-alpine with OpenSSL 3.3.2+ to address CVE-2024-6119
# Pinned to specific SHA256 digest for supply chain security and deterministic builds
# To update: podman pull node:22-alpine && podman inspect node:22-alpine --format '{{index .RepoDigests 0}}'
# Last updated: 2025-10-24
FROM node:22-alpine@sha256:d31216005bd330aa47f848822d4f269f6c79f0905b60cca1d87577149519daa6 AS builder

# Set build-time variables for reproducibility
ARG NODE_ENV=development
ARG BUILD_VERSION=dev
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG PORT=3081

# Set environment variables
ENV NODE_ENV=${NODE_ENV} \
    NODE_VERSION=22.1.0

# Set build-time labels
LABEL org.opencontainers.image.created=${BUILD_DATE} \
      org.opencontainers.image.version=${BUILD_VERSION} \
      org.opencontainers.image.revision=${VCS_REF}

# Set consistent timezone and locale
ENV TZ=UTC \
    LANG=C.UTF-8

# Create app directory
WORKDIR /usr/src/app

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    linux-headers

# Copy dependency files
COPY package.json package-lock.json ./

# Install dependencies with cache mount
RUN --mount=type=cache,target=/usr/src/app/.npm-cache \
    npm ci --cache /usr/src/app/.npm-cache && \
    npm cache clean --force && \
    rm -rf /usr/src/app/.npm-cache/*

# Copy source code
COPY . .

# Build TypeScript code with deterministic output
RUN npm run build

# Production stage
# Using node:22-alpine with OpenSSL 3.3.2+ to address CVE-2024-6119
# Pinned to specific SHA256 digest for supply chain security and deterministic builds
FROM node:22-alpine@sha256:d31216005bd330aa47f848822d4f269f6c79f0905b60cca1d87577149519daa6 AS production

# Declare build arguments in production stage
ARG PORT=3081
ARG NODE_ENV=development

# Set build-time labels
LABEL org.opencontainers.image.created=${BUILD_DATE} \
      org.opencontainers.image.version=${BUILD_VERSION} \
      org.opencontainers.image.revision=${VCS_REF}

# Set runtime environment
ENV NODE_ENV=${NODE_ENV} \
    PORT=${PORT} \
    TZ=UTC \
    LANG=C.UTF-8

WORKDIR /usr/src/app

# Create non-root user, certificate directory and logs directory
RUN addgroup -S bitgo && \
    adduser -S bitgo -G bitgo && \
    mkdir -p /app/certs && \
    mkdir -p /usr/src/app/logs && \
    chown -R bitgo:bitgo /app/certs && \
    chown -R bitgo:bitgo /usr/src/app && \
    chmod 750 /app/certs && \
    chmod 750 /usr/src/app/logs

# Copy only necessary files from builder
COPY --from=builder --chown=bitgo:bitgo /usr/src/app/dist ./dist
COPY --from=builder --chown=bitgo:bitgo /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=bitgo:bitgo /usr/src/app/bin ./bin
COPY --from=builder --chown=bitgo:bitgo /usr/src/app/package.json .

USER bitgo

# Expose port from build arg
EXPOSE ${PORT}

# Start the application using the binary
CMD ["./bin/advanced-wallet-manager"]
