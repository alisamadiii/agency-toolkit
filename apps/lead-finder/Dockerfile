# Coolify service: the daily scheduler + /health. The dashboard is not deployed;
# run it locally with `pnpm dev` against the same DATABASE_URL.
FROM node:22-slim
RUN corepack enable pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && chown -R node:node /app

USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
