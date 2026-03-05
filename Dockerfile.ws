# Multi-stage build for WebSocket server
# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Stage 2: Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Install pnpm and tsx for running TypeScript
RUN npm install -g pnpm tsx

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

# Copy dependencies
COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=appuser:nodejs /app/packages ./packages

# Copy source files needed for WebSocket server
COPY --chown=appuser:nodejs ./websocket-server.ts ./websocket-server.ts
COPY --chown=appuser:nodejs ./src ./src
COPY --chown=appuser:nodejs ./package.json ./package.json
COPY --chown=appuser:nodejs ./tsconfig.json ./tsconfig.json

# Switch to non-root user
USER appuser

# Expose WebSocket port
EXPOSE 3001

# Start WebSocket server
CMD ["tsx", "websocket-server.ts"]
