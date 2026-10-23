FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# The database lives on a volume at /data, owned by the unprivileged node user.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/auth > /dev/null || exit 1

CMD ["node", "--no-warnings", "server.js"]
