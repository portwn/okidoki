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
	find be/static/static/js -name 'main.*.js' -exec sed -i \
		-e 's|const om="https://api.portive.com"|const om = window.location.protocol + "//" + window.location.host|g' \
    	-e 's|match(/\[.\]portive\[.\]com\$$/i)|match(/localhost/i)|g' \
    	{} \;
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