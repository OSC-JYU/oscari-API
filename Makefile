DUOFILES := /home/arihayri/Pictures/DuoPrev/import
NFS := /tmp

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
		--mount type=bind,source=$(DUOFILES),target=/ca_import \
		--mount type=bind,source=$(NFS),target=/nfsdata \
		-e CA_URL=http://172.18.0.3/providence \
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
