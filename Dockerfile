# Combined Dockerfile for BhayanakCast Web App + WebSocket Server
# Uses concurrently to run both services in a single container

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Accept build arguments for environment variables
ARG VITE_WS_URL=http://localhost:3001
ARG VITE_BETTER_AUTH_URL=http://localhost:3000
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST=https://eu.i.posthog.com

# Make them available as environment variables during build
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_BETTER_AUTH_URL=${VITE_BETTER_AUTH_URL}
ENV VITE_POSTHOG_KEY=${VITE_POSTHOG_KEY}
ENV VITE_POSTHOG_HOST=${VITE_POSTHOG_HOST}
ENV NODE_ENV=production

# Build the application
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
COPY --from=builder --chown=appuser:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
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
