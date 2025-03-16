FROM oven/bun:1.2.2 AS base

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy application code
COPY . .

# Expose the port your application runs on
EXPOSE $PORT

# Start the application
CMD ["bun", "run", "start"] 