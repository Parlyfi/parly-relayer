FROM node:22-alpine
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --no-frozen-lockfile
RUN pnpm build
CMD ["pnpm", "start"]
