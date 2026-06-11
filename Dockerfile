# syntax=docker/dockerfile:1
#
# Static-site image for mesozoic-protocol.
# Built by .github/workflows/deploy.yml, pushed to GHCR, pulled by
# Coolify via docker-compose.yml. nginx serves the built bundle —
# no runtime Node, so dotenvx encryption isn't relevant here
# (anything sensitive should never reach the browser bundle anyway).
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS build
# Forwarded by the deploy workflow as `--build-arg VITE_BUILD_SHA=$GITHUB_SHA`.
# Vite's `loadEnv` picks it up via the ENV below and bakes a
# `<meta name="build-sha">` into index.html so post-deploy verification
# can confirm prod is serving the newly pushed image.
ARG VITE_BUILD_SHA=dev
ENV VITE_BUILD_SHA=${VITE_BUILD_SHA}
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
