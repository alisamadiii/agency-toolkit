FROM node:22-slim

# Python for the monitor, CA certs for HTTPS/SSL checks, tzdata for local times
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (writes the AI alert messages)
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

WORKDIR /app
COPY check_sites.py security_scan.py scheduler.py crons.py runner.py dashboard.py index.html sites*.json ./

# History + status are kept here (mounted as a persistent volume)
ENV DATA_DIR=/data PYTHONUNBUFFERED=1 DASHBOARD_PORT=8080
RUN mkdir -p /data && chown -R node:node /data /app
USER node

# Dashboard served here (publish the port in docker-compose)
EXPOSE 8080

CMD ["python3", "/app/scheduler.py"]
