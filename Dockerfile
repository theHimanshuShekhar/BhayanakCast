#--- Base Image ---#
# Using Bun for better TypeScript/JavaScript performance
FROM oven/bun AS base
WORKDIR /usr/src/app

#--- Environment Setup ---#
# Production mode optimizes for performance and security
ENV NODE_ENV=production

#--- Application Files ---#
# Copy source code and configuration files
COPY . .

#--- Test Stage ---#
FROM base AS test
# Set environment to development for tests
ENV NODE_ENV=development
# Install all dependencies including devDependencies
RUN bun install --frozen-lockfile
# Run Vitest tests
RUN bun test

#--- Builder Stage ---#
FROM base AS builder
#--- Dependencies ---#
# Install production deps with exact versions
# Excludes dev tools to reduce image size
RUN bun install --frozen-lockfile

# Build SSR application with node-server preset
RUN bun run build

#--- Production Stage ---#
FROM oven/bun AS deploy
# Copy only the optimized production build
COPY --from=builder /usr/src/app/.output .output
# Run as non-root user for container security
USER bun
# Start the server
ENTRYPOINT [ "bun", "run", ".output/server/index.mjs" ]
