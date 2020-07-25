
FROM node:current-alpine3.9

# Install app dependencies
COPY package.json /src/package.json
RUN cd /src; npm install

COPY ./app /src
WORKDIR /src
EXPOSE  8080
CMD ["node", "index.js"]

