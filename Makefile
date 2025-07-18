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

