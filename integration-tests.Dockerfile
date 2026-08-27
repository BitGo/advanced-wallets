# Stage 1 — build
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS builder

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
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS runner

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
