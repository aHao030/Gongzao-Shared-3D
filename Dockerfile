FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_PATH=/app/data/platform.sqlite
COPY --chown=node:node package.json BAMBU-GATEWAY-WINDOWS.cmd ./
COPY --chown=node:node services ./services
COPY --chown=node:node tools/admin-access.mjs tools/admin-backup.mjs tools/server-agent.mjs tools/bambu-gateway.mjs tools/build-bambu-gateway-kit.mjs ./tools/
COPY --chown=node:node packages ./packages
COPY --chown=node:node dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","services/platform/local.mjs","--host","0.0.0.0"]
