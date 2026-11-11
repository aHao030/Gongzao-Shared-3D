FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/manufacturing-python \
    && /opt/manufacturing-python/bin/pip install --no-cache-dir -r /app/requirements.txt
COPY engine.py client.mjs cli.mjs /app/
RUN mkdir -p /data && chown node:node /data
ENV PATH="/opt/manufacturing-python/bin:${PATH}"
USER node
CMD ["node", "/app/cli.mjs", "--config", "/run/gongzao/worker.config.json"]
# Mount a private configuration, read-only profiles and a writable work directory.
# PrusaSlicer is deliberately NOT bundled: install a pinned, license-compliant
# distribution with its runtime libraries in your derived worker image.
