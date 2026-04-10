FROM node:20-slim

# node-canvas system dependencies for chartjs-node-canvas
RUN apt-get update && apt-get install -y \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (including devDependencies for tsc build)
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

USER node

EXPOSE 3000

CMD ["node", "dist/index.js", "--mode", "slack"]
