FROM node:25-alpine

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production PORT=19283 RATE_LIMIT=10
EXPOSE 19283
CMD ["node", "src/server.js"]
