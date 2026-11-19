# Debian-based (not alpine): Playwright's bundled Chromium needs glibc.
FROM node:22-slim AS base
RUN corepack enable pnpm

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Build-time placeholders — never connected to; real values come at runtime.
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
ENV BETTER_AUTH_SECRET=build-placeholder
RUN pnpm build

FROM base AS runtime
WORKDIR /app

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

# Next standalone server
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations run at container start (drizzle-kit needs config + node_modules)
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/drizzle.config.ts ./
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Chromium for the page checker. Installed with the exact playwright version
# from node_modules; --with-deps pulls the needed system libraries via apt.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node node_modules/playwright/cli.js install --with-deps chromium \
  && chmod -R a+rX /ms-playwright \
  && rm -rf /var/lib/apt/lists/*

# Screenshots and other run artifacts
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
