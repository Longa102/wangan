# ===== Build Frontend =====
FROM node:22-alpine AS frontend
WORKDIR /src/demo
COPY demo/package*.json ./
RUN npm ci
COPY demo/ ./
RUN npm run build

# ===== Runtime =====
FROM node:22-alpine
LABEL title="wangan — LLM Agent Security Proxy v1.0"
LABEL description="提示注入与工具滥用检测防御系统 — 揭榜挑战赛题目5"

RUN apk add --no-cache curl

WORKDIR /app
COPY package*.json tsconfig.json ./
COPY config/ ./config/
COPY src/ ./src/
COPY scripts/demo-server.ts ./scripts/
COPY --from=frontend /src/demo/dist ./demo/dist

RUN npm ci --omit=dev \
    && npm install -g ts-node typescript \
    && mkdir -p logs

EXPOSE 3001
ENTRYPOINT ["npx", "ts-node", "--transpile-only", "scripts/demo-server.ts"]
