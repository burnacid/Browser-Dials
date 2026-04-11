# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy server code
COPY server/ .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3737

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3737/api/sync || exit 1

# Start server
CMD ["npm", "start"]
