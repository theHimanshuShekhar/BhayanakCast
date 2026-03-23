# Combined Dockerfile for BhayanakCast Web App + WebSocket Server
# Uses concurrently to run both services in a single container

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ pkgconfig

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Build the application
# Note: We don't bake client-side env vars at build time.
# Instead, we use runtime configuration via server functions.
ENV NODE_ENV=production
RUN pnpm build

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install pnpm and tsx for running TypeScript
RUN npm install -g pnpm tsx

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy built application
COPY --from=builder --chown=appuser:nodejs /app/.output ./.output
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder --chown=appuser:nodejs /app/websocket ./websocket
COPY --from=builder --chown=appuser:nodejs /app/src ./src
COPY --from=builder --chown=appuser:nodejs /app/tsconfig.json ./tsconfig.json

# Switch to non-root user
USER appuser

# Expose both ports
EXPOSE 3000 3001

# Start both services using concurrently
# Web app on port 3000, WebSocket on port 3001
CMD ["pnpm", "concurrently", "-n", "web,websocket", "-c", "cyan,yellow", "node .output/server/index.mjs", "tsx websocket/websocket-server.ts"]
