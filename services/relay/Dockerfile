# Game-agnostic Couch Kit relay. Zero runtime dependencies — just Bun.
FROM oven/bun:1

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV PORT=8787
EXPOSE 8787

# Health probe: GET /healthz -> 200
CMD ["bun", "src/server.ts"]
