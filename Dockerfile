# Lean agent container image
# Contains Node.js + Claude Agent SDK — no browser, no heavy tools

FROM node:20-slim

# Git is needed by Claude Code for file operations
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install container dependencies (claude-agent-sdk bundles the full CLI).
# --libc=glibc skips the musl native-binary variant of the SDK; npm filters
# optional deps by os/cpu automatically but not libc, and the SDK's binary
# resolver tries musl before glibc — so without this flag the kernel fails
# to exec the wrong binary and the SDK reports "claude not found".
COPY container/package.json ./
RUN npm install --production --libc=glibc

# tsx for running TypeScript entrypoint
RUN npm install tsx

# Copy entrypoint
COPY container/entrypoint.ts ./

# Create non-root user (Claude Code refuses bypassPermissions as root)
RUN useradd -m -s /bin/bash -u 999 agent

# Create workspace directory owned by agent
RUN mkdir -p /workspace && chown agent:agent /workspace

USER agent

CMD ["npx", "tsx", "entrypoint.ts"]
