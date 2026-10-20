# syntax=docker/dockerfile:1
# `slim` target: no browser. A `full` target (Playwright) lands in M2.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

FROM node:24-slim AS slim
ENV NODE_ENV=production PW_DATABASE_URL=file:/data/pricewatch.db
RUN useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin pricewatch \
    && mkdir /data && chown pricewatch:pricewatch /data \
    && printf '#!/bin/sh\nexec node /app/dist/main.js "$@"\n' > /usr/local/bin/pricewatch \
    && chmod +x /usr/local/bin/pricewatch
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
USER pricewatch
VOLUME /data
EXPOSE 8080
# Ignored by `run`/`migrate`, which exit on their own.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PW_PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["pricewatch"]
CMD ["serve"]
