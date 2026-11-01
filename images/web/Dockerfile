FROM oven/bun:1.4.4

WORKDIR /app
COPY web/package.json web/bun.lock* ./
RUN bun install
COPY web/ ./

ENV DATA_MODE=api
ENV API_BASE_URL=http://api:8000
EXPOSE 3000
CMD ["bun", "run", "dev", "--", "--hostname", "0.0.0.0"]
