IMPORT := /home/arihayri/Pictures

build:
	docker build -t osc/oscari-api:latest .

push:
	docker push osc/oscari-api:latest

pull:
	docker pull osc/oscari-api:latest

start:
	docker run -d --name oscari-api \
		-p 8080:8080 \
		--network oscari-net \
		--mount type=bind,source=$(IMPORT),target=/import \
		--volume oscari-data:/files \
		-e CA_URL=http://collectiveaccess/providence \
		-e CA_IMPORT=/var/www/providence/import \
		-e CA_AUTH=collectiveaccess \
		-e DOCKER_VOLUME=yes \
		-e DB_HOST=mariadb \
		-e DB_USER=root \
		-e DB_PW=root \
		-e DB_NAME=c_access \
		--restart unless-stopped \
		 osc/oscari-api

restart:
	docker stop oscari-api
	docker rm oscari-api
	$(MAKE) start

bash:
	docker exec -it oscari-api bash
