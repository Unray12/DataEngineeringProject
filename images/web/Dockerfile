FROM oven/bun:1.4.4

WORKDIR /app
COPY web/package.json web/bun.lock* ./
RUN bun install
COPY web/ ./

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they are build args.
ARG NEXT_PUBLIC_APP_NAME=AgriMonitor
ARG NEXT_PUBLIC_TIMEZONE=Asia/Ho_Chi_Minh
ENV DATA_MODE=api \
    API_BASE_URL=http://api:8000 \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_TIMEZONE=$NEXT_PUBLIC_TIMEZONE \
    NEXT_TELEMETRY_DISABLED=1

# Production build. The image used to run `next dev`, which recompiles on demand and added about
# 200 ms to every page and /api request (benchmark #6); `bun run dev` is still there for local work.
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start", "--", "--hostname", "0.0.0.0"]
