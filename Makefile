IMPORT := /home/arihayri/Pictures/import
VERSION := 0.1

build:
	docker build -t osc/oscari-api:$(VERSION) .

start:
	docker run -d --name oscari-api \
		-p 8080:8080 \
		--network oscari-net \
		--mount type=bind,source=$(IMPORT),target=/import \
		--volume oscari-data:/files \
		-e CA_URL=http://collectiveaccess/providence \
		-e CA_IMPORT=/var/www/providence/import \
		-e CA_AUTH=dummyUser \
		-e DOCKER_VOLUME=yes \
		-e DB_HOST=mariadb \
		-e DB_USER=root \
		-e DB_PW=root \
		-e DB_NAME=c_access \
		-e DEBUG=error,router,debug \
		osc/oscari-api:$(VERSION)

restart:
	docker stop oscari-api
	docker rm oscari-api
	$(MAKE) start

bash:
	docker exec -it oscari-api bash
