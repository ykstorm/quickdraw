FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quickdraw
COPY --from=prod-deps --chown=quickdraw:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=quickdraw:nodejs /app/dist ./dist
COPY --chown=quickdraw:nodejs package.json ./
USER quickdraw
ENTRYPOINT ["node", "dist/bin/cli.js"]
