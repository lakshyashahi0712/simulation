FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run web:build && npm run build:server

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/web ./dist/web

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV SENTINEL_STATIC_WEB=dist/web
EXPOSE 3001

CMD ["node", "dist/server/server/index.js"]
