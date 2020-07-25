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
		--volume collectiveaccess-data:/ca_media \
		--restart unless-stopped \
		 osc/oscari-api

restart:
	docker stop oscari-api
	docker rm oscari-api
	$(MAKE) start

bash:
	docker exec -it oscari-api bash
