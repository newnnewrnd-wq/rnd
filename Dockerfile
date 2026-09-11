FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/accounts.sqlite
WORKDIR /app
COPY --chown=node:node dist ./dist
COPY --chown=node:node standalone ./standalone
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "standalone/server.mjs"]
