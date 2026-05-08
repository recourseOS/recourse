FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install

COPY webhook.ts ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -S recourse && adduser -S recourse -G recourse
USER recourse

ENV PORT=8443
ENV NODE_ENV=production

EXPOSE 8443

CMD ["node", "dist/webhook.js"]
