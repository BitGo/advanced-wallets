# Stage 1 — build
FROM node:22.23.4-alpine@sha256:ce8d97f7cfc7c5386421eb932df20a29df99b1a7f469f6157d5c9956702ffadc AS builder

ENV NODE_ENV=test \
    TZ=UTC \
    LANG=C.UTF-8

WORKDIR /usr/src/app

# native addons (e.g. keccak) require build tools
RUN apk add --no-cache python3 make g++ gcc linux-headers

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

# Stage 2 — test runner
FROM node:22.23.4-alpine@sha256:ce8d97f7cfc7c5386421eb932df20a29df99b1a7f469f6157d5c9956702ffadc AS runner

ENV NODE_ENV=test \
    TZ=UTC \
    LANG=C.UTF-8

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/bin ./bin
COPY --from=builder /usr/src/app/src ./src
COPY --from=builder /usr/src/app/package.json .
COPY --from=builder /usr/src/app/.mocharc.integ.js .
COPY --from=builder /usr/src/app/tsconfig.integ.json .
COPY --from=builder /usr/src/app/tsconfig.json .

CMD ["npm", "run", "test:integration"]
