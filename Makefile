# Static binaries: pure-Go deps need no CGO, and static linking runs on both
# glibc and musl (Alpine) — the release linux/amd64 asset must be static.
export CGO_ENABLED=0

run-fe:
	@echo "Starting frontend..."
	cd fe && npm start

run-be:
	@echo "Starting backend..."
	cd be && go run ./...

build-static:
	@echo "Building React static files..."
	cd fe && npm run build
	@echo "Static files built in fe/build/"
	rm -rf be/static
	mkdir -p be/static
	cp -r fe/build/* be/static/
	rm -rf fe/build
	@echo "Build complete!"

build-be: build-static
	@echo "Building backend binaries for multiple platforms..."
	mkdir -p bin

	# Linux
	@echo "Building for Linux (amd64)..."
	cd be && GOOS=linux GOARCH=amd64 go build -o ../bin/okidoki-linux-amd64 ./...

	@echo "Building for Linux (arm64)..."
	cd be && GOOS=linux GOARCH=arm64 go build -o ../bin/okidoki-linux-arm64 ./...

	# Windows
	@echo "Building for Windows (amd64)..."
	cd be && GOOS=windows GOARCH=amd64 go build -o ../bin/okidoki-windows-amd64.exe ./...

	# macOS
	@echo "Building for macOS (amd64)..."
	cd be && GOOS=darwin GOARCH=amd64 go build -o ../bin/okidoki-darwin-amd64 ./...

	@echo "Building for macOS (arm64)..."
	cd be && GOOS=darwin GOARCH=arm64 go build -o ../bin/okidoki-darwin-arm64 ./...

	@echo "Build complete! Binaries are in bin/ directory"