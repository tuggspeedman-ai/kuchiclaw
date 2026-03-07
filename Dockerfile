# Lean agent container image
# Contains Node.js + Claude Agent SDK — no browser, no heavy tools

FROM node:20-slim

# Git is needed by Claude Code for file operations
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install container dependencies (claude-agent-sdk bundles the full CLI)
COPY container/package.json ./
RUN npm install --production

# tsx for running TypeScript entrypoint
RUN npm install tsx

# Copy entrypoint
COPY container/entrypoint.ts ./

# Create non-root user (Claude Code refuses bypassPermissions as root)
RUN useradd -m -s /bin/bash agent

# Create workspace directory owned by agent
RUN mkdir -p /workspace && chown agent:agent /workspace

USER agent

CMD ["npx", "tsx", "entrypoint.ts"]
