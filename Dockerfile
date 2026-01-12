FROM alpine:latest

RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    wget \
    curl \
    jq \
    libc6-compat

WORKDIR /app

ARG VERSION=latest

RUN set -eux; \
    if [ "$VERSION" = "latest" ]; then \
        VERSION="$(curl -s https://api.github.com/repos/portwn/okidoki/releases/latest | jq -r .tag_name)"; \
    fi; \
    echo "Using version: $VERSION"; \
    DOWNLOAD_URL="https://github.com/portwn/okidoki/releases/download/${VERSION}/okidoki-linux-amd64"; \
    wget -O /app/okidoki "$DOWNLOAD_URL"; \
    chmod +x /app/okidoki

VOLUME /app/data
EXPOSE 8080

CMD ["/app/okidoki"]
