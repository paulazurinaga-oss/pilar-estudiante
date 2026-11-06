FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=node:node . .
RUN mkdir -p /data/storage && chown node:node /data/storage

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV FFMPEG_BIN=/usr/bin/ffmpeg

EXPOSE 3000

USER node

CMD ["node", "server.js"]
