FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata wget libc6-compat

WORKDIR /app

ARG VERSION=v0.0

RUN set -eux; \
    if [ "$VERSION" = "latest" ]; then \
        DOWNLOAD_URL="https://github.com/portwn/okidoki/releases/download/v0.1/okidoki-linux-amd64"; \
    else \
        DOWNLOAD_URL="https://github.com/portwn/okidoki/releases/download/${VERSION}/okidoki-linux-amd64"; \
    fi; \
    wget -O /app/okidoki "$DOWNLOAD_URL" && \
    chmod +x /app/okidoki && \
    ls -la /app/okidoki

VOLUME /app/data
EXPOSE 8080

CMD ["/app/okidoki"]