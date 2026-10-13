# syntax=docker/dockerfile:1

# --- Frontend: build the CRA static bundle ---
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY fe/package.json fe/package-lock.json ./
RUN npm ci
COPY fe/ ./
RUN npm run build

# --- Backend: build the binary with the embedded static bundle ---
# CGO is off; all deps are pure Go, so the musl (Alpine) toolchain is not needed.
FROM golang:1.24-alpine AS backend
WORKDIR /be
COPY be/ ./
# //go:embed static/* requires a non-empty directory — drop the built SPA in.
COPY --from=frontend /fe/build ./static
RUN CGO_ENABLED=0 GOOS=linux go build -o /okidoki ./...

# --- Runtime ---
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /okidoki ./okidoki

VOLUME /app/data
EXPOSE 8080

# /api/documents — a cheap probe (no git status access).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/documents >/dev/null || exit 1

CMD ["/app/okidoki"]
