FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quickdraw
COPY --from=prod-deps --chown=quickdraw:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=quickdraw:nodejs /app/dist ./dist
COPY --from=builder --chown=quickdraw:nodejs /app/bin ./bin
COPY --chown=quickdraw:nodejs package.json ./
USER quickdraw
ENTRYPOINT ["node", "dist/bin/cli.js"]
