#!/bin/sh

# check if we are using docker volumes and if yes, then chown them to "node"
if [ "$DOCKER_VOLUME" = "yes" ]; then
	echo 'entrypoint.sh: Running chown for /files'
	chown -R node:node /files
else
	echo 'entrypoint.sh: No need to chown /files'
fi

runuser node -c 'node index.js'

