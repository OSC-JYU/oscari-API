
# Oscari API

Oscari API is a backend for Finnish Oscari museum information system called Oscari (Oscari UI is released later). Oscari is based on CollectiveAccess with Finnish installation profile. In its current state Oscari-API is *NOT* a generic, third-party API for CollectiveAccess.

Oscari API is designed for creating user interfaces for CA data.

Under the hood Oscari api uses both original api of CA and direct mysql queries. Write operations are executed via original api (i.e. you **do not** need to give write permissions to the mysql). 



## Install

Install first CollectiveAccess 1.7.8 with *Finnish installation profile* (JYU/OSC). You can use this Docker setup: [https://github.com/artturimatias/CollectiveAccess] (https://github.com/artturimatias/CollectiveAccess)

    git clone this
    cd this
    npm install

Then open config.json.example anda save it as **config.json**.


    
Then just start the engine.

    cd app
    node index.js


## Authentication

API uses cookie-based sessions, so you must somehow save the cookie for future requests when working on command line. One good option is Httppie.

### CollectiveAccess (default)

In order to login with CA credentials, send a request to login endpoint:

	http --session=/tmp/oscari.json POST :8080/api/ca/login username=USERNAME password=YOUR_PASS


### Shibboleth
Logs user to CollectiveAccess based on Shibboleth header. You do not need Shibboleth for testing. Just make sure that you have user with valid CA credentials in users section in config.json and "dummyUser" pointing to that user.

	"shibboleth": {
		"headerId": "mail",
		"users": {
			"user@user.fi": {
				"ca_user": "administrator",
				"ca_password": "secret_password" 
			}
		},
		"dummyUser": "user@user.fi"
	}

Then just make a request to login endpoint without any parameters:

	http --session=/tmp/oscari.json POST :8080/api/ca/login




http --session=/tmp/oscari.json :8080/api/ca/status

http --session=/tmp/oscari.json :8080/api/ca/forms/objects_ui

http --session=/tmp/oscari.json :8080/api/ca/forms/objects_ui/models/esine

http --session=/tmp/oscari.json :8080/api/ca/lists/yleisnimet

http --session=/tmp/oscari.json :8080/api/ca/metadataelements

http --session=/tmp/oscari.json :8080/api/ca/metadataelements/yleisnimi





