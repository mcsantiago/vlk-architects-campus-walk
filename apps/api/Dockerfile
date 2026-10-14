# Build from the repo root: docker build -f apps/api/Dockerfile .
# Installs only the api and shared workspaces (production deps; tsx is the runtime).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @campus-walk/api --workspace @campus-walk/shared

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]
