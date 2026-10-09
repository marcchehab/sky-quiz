# Sky Stories server (skystories.eduskript.org): the page from dist/ + server/
FROM node:24-slim
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY dist dist
COPY server server
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
EXPOSE 3000
CMD ["node", "server/server.mjs"]
