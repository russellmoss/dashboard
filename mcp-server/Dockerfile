FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Q3: Bundle schema-config.yaml for the schema_context tool
COPY schema-config.yaml /app/schema-config.yaml
ENV PORT=8080
ENV SCHEMA_CONFIG_PATH=/app/schema-config.yaml
EXPOSE 8080
CMD ["node", "dist/index.js"]
