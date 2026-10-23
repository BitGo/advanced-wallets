# Stage 1 — build
FROM node:24.22.1-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS builder

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
FROM node:24.22.1-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS runner

# Node 24 sizes its default heap from container memory and ts-node compilation
# exhausts it, getting the suite OOM-killed; an explicit cap keeps GC working.
ENV NODE_ENV=test \
    NODE_OPTIONS=--max-old-space-size=4096 \
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
