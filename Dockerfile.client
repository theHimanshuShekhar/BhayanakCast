# Use the official Node.js image as the base image
FROM node:23.5-alpine AS base

# Set environment variables for pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Enable corepack to manage package managers
RUN corepack enable

# Copy the entire application code to the /app directory in the container
COPY . /app

# Set the working directory to /app
WORKDIR /app

# Stage for installing production dependencies
FROM base AS prod-deps

# Use a cache mount for pnpm store and install only production dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# Stage for building the application
FROM base AS build

# Use a cache mount for pnpm store and install all dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the application using the node-server preset
RUN pnpm run build --preset node-server

# Final stage to create the runtime image
FROM node:23.5-alpine AS deploy

# Copy the built output from the build stage
COPY --from=build app/.output .output

# Expose port 3000 for the application
EXPOSE 3000/tcp

# Set the entry point to run the application
ENTRYPOINT [ "node", ".output/server/index.mjs" ]
