
FROM node:12.18.3

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json ./

RUN npm install

COPY --chown=node:node ./app .

COPY entrypoint.sh ./entrypoint.sh
ENTRYPOINT ["/bin/sh", "entrypoint.sh"]

EXPOSE  8080
#CMD ["node", "index.js"]

