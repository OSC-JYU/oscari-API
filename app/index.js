const Koa 			= require('koa');
const Router 		= require('koa-router');
const bodyParser 	= require('koa-body');
const send	 		= require('koa-send');
const json 			= require('koa-json')
const serve			= require('koa-static');
const cors 			= require('@koa/cors')
const session		= require('koa-session');
const fs 			= require('fs');
const fsPromises 	= require('fs').promises;
const path 			= require('path');
const stream 		= require('stream');
const util 			= require('util');
const sharp			= require('sharp');
const request		= require('request');
const requestp		= require('request-promise-native');
const mysql			= require('mysql')
var debug			= require('debug')('debug');
var debugRouter		= require('debug')('router');
const winston 		= require('winston');

var CA				= require('./CollectiveAccess.js');
var Media			= require('./Media.js');

const STATIC_PATH = 'public'
var rootDir = "/OSCARI-siirto"

// from https://github.com/collectiveaccess/providence/blob/master/app/conf/datamodel.conf
const TABLES = {
	'ca_collections': 	13,
	'ca_entities': 		20,
	'ca_lists': 		36,
	'ca_object_lots': 	51,
	'ca_object_representations': 	56,
	'ca_objects': 		57,
	'ca_objects_x_entities': 59,
	'ca_objects_x_objects': 62,
	'ca_objects_x_occurrences': 63,
	'ca_objects_x_places': 64,
	'ca_occurrences': 	67,
	'ca_places': 		72
}


let config;
let client;
let ca;
let media;
let sessions = {};

const pipeline = util.promisify(stream.pipeline);
const { createClient } = require("webdav");

var app 			= new Koa();
var router 			= new Router();

const SESSION_CONFIG = {
  key: 'oscari.sess'
}
app.keys = ['Shh, its OScari!'];
app.use(session(SESSION_CONFIG, app));  // Include the session middleware


// LOGGING
require('winston-daily-rotate-file');
 
var rotatedLog = new (winston.transports.DailyRotateFile)({
	filename: 'logs/oscari-%DATE%.log',
	datePattern: 'YYYY-MM',
	zippedArchive: false,
	maxSize: '20m'
});

const logger = winston.createLogger({
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.prettyPrint()
	),
	transports: [
		new winston.transports.Console(),
		rotatedLog
	]
});
logger.info('Oscari-API started');
// LOGGING ENDS

//Set up body parsing middleware
app.use(bodyParser({
   multipart: true,
   urlencoded: true
}));

var options = {
    origin: '*'
};

app.use(cors(options));
app.use(json({ pretty: true, param: 'pretty' }))

app.use(async function handleError(context, next) {
	try {
		await next();
	} catch (error) {
		context.status = 500;
		var error_msg = error
		if(error.status) context.status = error.status
		if(error.message) error_msg = error.message
		
		logger.error({
			user:context.request.headers.mail, 
			message: error_msg, 
			params: context.params,
			path: context.path,
			body: context.request.body,
			error: error
		});
		context.body = {'error':error_msg};

		debug(error.stack);
	}
});



app.use(async (ctx, next) => {
	debugRouter(ctx.method, ctx.path)
	await next();
})


//app.use(serve(__dirname + '/' + STATIC_PATH));

router.get('/', function(ctx) {
	//return send(ctx, 'index.html', { root: __dirname + '/public' });
	ctx.body = {api: 'Oscari-API - a third party API for CollectiveAccess'}
})


// auth
app.use(async (ctx, next) => {
	// dummyUser is for testing without Shibboleth
	if(config.authentication == 'dummyUser' && config.shibboleth.dummyUser) {
		// check that dummyUser is not used in production
		if(ctx.headers[config.shibboleth.headerId]) throw('Configuration error: Can not use dummyUser on shibboleth install!')
		else ctx.headers[config.shibboleth.headerId] = config.shibboleth.dummyUser;
	}
	
	// always accessible paths
	 if(ctx.path == '/api/ca/login' || ctx.path == '/api/ca/config' ) {
		await next()
		
	// all other paths are restricted
	} else {
		if (isValidUser(ctx)) {
			await next()
		} else {
			//ctx.session.view = 0;
			ctx.status = 401;
			ctx.body = {'error': 'ei käyttöoikeuksia'};
		}
	}

})




/*********************************************************************************
 *  					COLLECTIVEACCESS
 * *******************************************************************************/

router.post('/api/ca/logout', async function(ctx) {
	ctx.session = null;
	ctx.body = {msg: 'logged out'}
})

// login user based on Shibboleth user name
router.post('/api/ca/login', async function(ctx) {

	if(config.authentication == 'dummyUser') {
		console.log(config.shibboleth.users)
		var user = config.shibboleth.users[config.shibboleth['dummyUser']]
		console.log(user)
		var auth = {
			auth: {
				username: user.ca_username,
				password: user.ca_password
			}
		}
		
	} else if(config.authentication == 'shibboleth') {
		if(!config.shibboleth.users[ctx.headers[config.shibboleth.headerId]]) {
			console.log(config.shibboleth.headerId)
			console.log(ctx.headers[config.shibboleth.headerId])
			console.log(ctx.headers)
			console.log(config.shibboleth.users)
			throw('Shibboleth login failed')
		}

		var user = config.shibboleth.users[ctx.headers[config.shibboleth.headerId]]
		var auth = {
			auth: {
				username: user.ca_username,
				password: user.ca_password
			}
		}
	} else if(config.authentication == 'collectiveaccess') {
		var auth = {
			auth: {
				username: ctx.request.body.username,
				password: ctx.request.body.password
			}
		}
	}
	debug(auth)
	var ca_user = await ca.getUserId(auth.auth.username); // we want internal user ID
	debug(config.collectiveaccess.url)
	try {
		debug(config.collectiveaccess.url + "/service.php/auth/login")
		var login_result = await requestp(config.collectiveaccess.url + "/service.php/auth/login", auth)
		var login_json = JSON.parse(login_result);
		debug(login_json)
		var user = {username: auth.auth.username, user_id: ca_user, token: login_json.authToken}
		ctx.session.user = user;
		ctx.body = {user: auth.auth.username, auth: config.authentication}
	} catch(e) {
		debug(e)
		throw('Login failed')
	}

})


router.get('/api/ca/login', async function(ctx) {

	if(!ctx.session.user) {
		ctx.status = 401;
		ctx.body = {auth: config.authentication}
	}
	try {
		var url =config.collectiveaccess.url + '/service.php/auth/login?authToken=' + ctx.session.user.token
		var result = await requestp(url)
		if(config.authentication == 'shibboleth' || config.authentication == 'dummyUser') {
			if(ctx.session.user) {
				ctx.body = {'user': ctx.get(config.shibboleth.headerId), 'token': 'yes' }
			}

		} else if(config.authentication == 'collectiveaccess') {
			if(ctx.session.user.username) ctx.body = {
				'user': ctx.session.user.username,
				'auth': config.authentication,
				'token': 'yes'}
		}
	} catch(e) {
		ctx.status = 401;
		ctx.body = {
			'error': 'not logged in',
			'auth': config.authentication
		}
	}

})


// login user based on Shibboleth user name
router.get('/api/ca/config', function(ctx) {
	ctx.body = {auth: config.authentication}
})


router.get('/api/ca/locales', async function(ctx, next) {
	ctx.body = ca.getLocales();
})


router.get('/api/ca/elements', async function(ctx, next) {
	ctx.body = ca.getElements();
})

router.get('/api/ca/storage_locations', async function(ctx, next) {
	ctx.body = await ca.getStorageLocations(ctx.query.parent);
})


/*********************************************************************************
 *  					individual items
 * *******************************************************************************/

router.get('/api/ca/object_lots/:id', async function(ctx) {
	//var url = config.collectiveaccess.url + "/service.php/item/ca_object_lots/id/"+ctx.params.id+"?pretty=1&authToken=" + ctx.session.user.token
	//var result = await requestp(url)
	var item = await ca.getItem("ca_object_lots", ctx.params.id, getLocale(ctx))
	ctx.body = item;

})


router.get('/api/ca/objects/:id', async function(ctx, next) {
	//var item = await ca.getItemFromAPI("ca_objects", ctx.params.id, ctx.session.user.token)
	var item = await ca.getItem("ca_objects", ctx.params.id, getLocale(ctx))
	if(!item) {
			ctx.status = 404;
			ctx.body = {};
	} else {
		if(ctx.query.form){
			var form = await ca.getInputFormAndModel(ctx, ctx.query.form, item.typename);
			var out = {screens: {}}
			for(var screen in form.screens) {
				out.screens[screen] = []
				if(form.screens[screen].bundles) {
					for(var b of form.screens[screen].bundles) {
						var b_obj = {'name': b.bundle_name}
						if(item.elements[b.bundle_name]) b_obj.element = item.elements[b.bundle_name]
						out.screens[screen].push(b_obj)
					}
				}
			}
			item.form = out;
		}
		ctx.body = item;
	}
})


router.get('/api/ca/entities/:id', async function(ctx, next) {
	//var item = await ca.getItemFromAPI("ca_objects", ctx.params.id, ctx.session.user.token)
	var item = await ca.getItem("ca_entities", ctx.params.id, getLocale(ctx))
	//await ca.getInputFormAndModel(ctx);
	ctx.body = item;
})


router.get('/api/ca/storage_locations/:id', async function(ctx, next) {
	//var item = await ca.getItemFromAPI("ca_objects", ctx.params.id, ctx.session.user.token)
	var item = await ca.getItem("ca_storage_locations", ctx.params.id, getLocale(ctx))
	if(item && item.parent_id) item.parent = await ca.getStorageLocationParent(item.parent_id)
	ctx.body = item;
})


router.get('/api/ca/occurrences/:id', async function(ctx, next) {
	//var item = await ca.getItemFromAPI("ca_objects", ctx.params.id, ctx.session.user.token)
	var item = await ca.getItem("ca_occurrences", ctx.params.id, getLocale(ctx))
	if(ctx.query.form){
		var form = await ca.getInputFormAndModel(ctx, 'occurrences_ui', 'haastattelu');
		var out = {screens: {}}
		for(var screen in form.screens) {
			console.log(screen)
			out.screens[screen] = []
			if(form.screens[screen].bundles) {
				for(var b of form.screens[screen].bundles) {
					var b_obj = {'name': b.bundle_name}
					if(item.elements[b.bundle_name]) b_obj.element = item.elements[b.bundle_name]
					out.screens[screen].push(b_obj)
				}
			}
		}
		item.form = out;
	}
	ctx.body = item;
})


router.get('/api/ca/collections/:id', async function(ctx, next) {
	//var item = await ca.getItemFromAPI("ca_objects", ctx.params.id, ctx.session.user.token)
	var item = await ca.getItem("ca_collections", ctx.params.id, getLocale(ctx))
	ctx.body = item;
})


router.put('/api/ca/objects', async function(ctx, next) {

	try {
		result = await ca.createItem("ca_objects", ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Object creation failed!", e)
	}
})

router.put('/api/ca/objects/:id', async function(ctx, next) {

	try {
		result = await ca.editItem("ca_objects", ctx.params.id, ctx.request.body, ctx.session.user.token, ctx.session.user.user_id);
		ctx.body = result;
	} catch(e) {
		throw("Object editing failed!", e)
	}
})

router.put('/api/ca/entities/:id', async function(ctx, next) {

	try {
		result = await ca.editItem("ca_entities", ctx.params.id, ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Entity editing failed!", e)
	}
})

router.put('/api/ca/entities', async function(ctx, next) {

	try {
		result = await ca.createItem("ca_entities", ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Entity creation failed!", e)
	}
})


router.put('/api/ca/object_lots/:id', async function(ctx, next) {

	try {
		result = await ca.editItem("ca_object_lots", ctx.params.id, ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Object LOT editing failed!", e)
	}
})


router.put('/api/ca/object_lots', async function(ctx, next) {
	try {
		result = await ca.createItem("ca_object_lots", ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Object lot creation failed!", e)
	}
})



router.put('/api/ca/collections', async function(ctx, next) {

	try {
		result = await ca.createItem("ca_collections", ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Collection creation failed!", e)
	}
})

router.put('/api/ca/occurrences', async function(ctx, next) {

	try {
		result = await ca.createItem("ca_occurrences", ctx.request.body, ctx.session.user.token);
		ctx.body = result;
	} catch(e) {
		throw("Occurrence creation failed!", e)
	}
})



router.get('/api/ca/representations/:id', async function(ctx, next) {
	var url = config.collectiveaccess.url + "/service.php/item/ca_object_representations/id/" + ctx.params.id + "?pretty=1&authToken=" + ctx.session.user.token;
	var result = await requestp(url)
	ctx.body = result;

})

router.put('/api/ca/representations/:id', async function(ctx, next) {
	try {
		result = await ca.editItem("ca_object_representations", ctx.params.id, ctx.request.body, ctx.session.user.token, ctx.session.user.user_id);
		ctx.body = result;
	} catch(e) {
		throw("Representation editing failed!", e)
	}

})


/*********************************************************************************
 *  					metadata elements
 * *******************************************************************************/

router.get('/api/ca/metadataelements', async function(ctx, next) {
	var elements = await ca.getMetadataElements()
	ctx.body = elements;
})

router.get('/api/ca/metadataelements/:code', async function(ctx, next) {
	var elements = await ca.getMetadataElement(ctx.params.code)
	ctx.body = elements;
})

/*********************************************************************************
 *  					lists
 * *******************************************************************************/


router.get('/api/ca/lists', async function(ctx, next) {
	var lists = await ca.getLists()
	ctx.body = lists;
})



router.get('/api/ca/lists/:id', async function(ctx, next) {
	var list = await ca.getList(ctx.params.id, getLocale(ctx))
	ctx.body = list;
})




router.get('/api/ca/lists/:id/items/:item', async function(ctx, next) {
	var item = await ca.getListItem(ctx.params.id, ctx.params.item, getLocale(ctx))
	ctx.body = item;
})



router.put('/api/ca/lists/:id/items', async function(ctx, next) {
	console.log(ctx.session.user.token)
	var item = await ca.createListItem(ctx.params.id, ctx.request.body, ctx.session.user.token)
	ctx.body = item;
})



/*********************************************************************************
 *  					sets
 * *******************************************************************************/

router.get('/api/ca/sets', async function(ctx, next) {
	debug(ctx.session.user)
	var sets = await ca.getSets(ctx.session.user.user_id)
	ctx.body = sets;
})

router.post('/api/ca/sets', async function(ctx, next) {
	var newset = await ca.createSet(ctx.request.body, 'ca_objects', getLocale(ctx), ctx)
	ctx.body = newset;
})

router.get('/api/ca/sets/:name', async function(ctx, next) {
	var items = await ca.getSet(ctx.params.name, getLocale(ctx))
	ctx.body = items;
})

router.delete('/api/ca/sets/:name', async function(ctx, next) {
	var items = await ca.deleteSet(ctx.params.name, ctx)
	ctx.body = items;
})


router.put('/api/ca/sets/:name/items', async function(ctx, next) {
	var items = await ca.createSetItems(ctx.params.name, ctx.request.body, getLocale(ctx))
	ctx.body = items;
})

router.delete('/api/ca/sets/:name/items/:item', async function(ctx, next) {
	var items = await ca.removeSetItem(ctx.params.name, ctx.params.item)
	ctx.body = items;
})


/*********************************************************************************
 *  					models
 * *******************************************************************************/

router.get('/api/ca/tables/:table/models', async function(ctx) {
	var url = config.collectiveaccess.url + "/service.php/model/" + ctx.params.table + "?pretty=1&authToken=" + ctx.session.user.token;
	var result = await requestp(url)
	ctx.body = result;
})


router.get('/api/ca/tables/:table/models/:model/', async function(ctx) {
	var url = config.collectiveaccess.url + "/service.php/model/" + ctx.params.table + "?pretty=1&authToken=" + ctx.session.user.token;
	var result = await requestp(url)
	ctx.body = result[ctx.params.model];
})



/*********************************************************************************
 *  					displays
 * *******************************************************************************/

router.get('/api/ca/displays', async function(ctx) {
	var sql = "SELECT display.display_code, display.table_num, label.name FROM ca_bundle_displays display INNER JOIN ca_bundle_display_labels label ON label.display_id = display.display_id;"
	var displays = await makeQuery(sql)
	var displays_with_tables = setTableNames(displays, 'table_num');
	ctx.body = groupBy(displays_with_tables, 'table_num', 'displays');
})



router.get('/api/ca/displays/:display_code', async function(ctx) {
	var sql = "SELECT display.display_id, display.display_code, display.table_num, label.name FROM ca_bundle_displays display INNER JOIN ca_bundle_display_labels label ON label.display_id = display.display_id WHERE display.display_code = '"+ctx.params.display_code+"';"
	var display = await makeQuery(sql)
	var sql_bundles = "select bundle_name from ca_bundle_display_placements WHERE display_id = "+display[0].display_id+"; "
	display[0].bundles = await makeQuery(sql_bundles)
	ctx.body = display[0]
})




/*********************************************************************************
 *  					find
 * *******************************************************************************/

router.get('/api/ca/find', async function(ctx) {

	// we want description
	var adv = {
		"bundles": {
			"description" : {},
			"ca_storage_locations.parent.preferred_labels.name":{},
			"yleisnimi" : {"convertCodesToDisplayText": true},
			"ca_object_representations.media.tiny" : {"returnAsArray" : true}
		}
	}

	//if(!ctx.query.q.includes('*')) ctx.query.q = ctx.query.q + '*'
	var paging = ca.getPaging(ctx);

	var objects_url = config.collectiveaccess.url + "/service.php/find/ca_objects?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token ;
	var entities_url = config.collectiveaccess.url + "/service.php/find/ca_entities?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token;
	var lots_url = config.collectiveaccess.url + "/service.php/find/ca_object_lots?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token;
	//var collections_url = config.collectiveaccess.url + "/service.php/find/ca_collections?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token;
	var locations_url = config.collectiveaccess.url + "/service.php/find/ca_storage_locations?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token;
	var occurrences_url = config.collectiveaccess.url + "/service.php/find/ca_occurrences?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token;

	console.log(locations_url)

	const [objects, entities, lots, locations, occurrences] = await Promise.all([
		requestp(objects_url + cacheRand(), {json:adv}),
		requestp(entities_url + cacheRand(), {json:adv}),
		requestp(lots_url + cacheRand(), {json:adv}),
		requestp(locations_url + cacheRand(), {json:adv}),
		requestp(occurrences_url + cacheRand(), {json:adv})
	]);

	/*
	.catch(function(err) {
	  console.log(err.message); // some coding error in handling happened
	  ctx.status = 500;
	  ctx.body = err.message
	});
*/
	ctx.body = {objects: objects, entities: entities, object_lots: lots,  storage_locations: locations, occurrences: occurrences}
})



router.get('/api/ca/find/:table', async function(ctx) {


	// we want description
	var adv = {
		"bundles": {
			"idno": {},
			"description" : {},
			"pvm_cont": {},
			"ca_storage_locations.preferred_labels.name":{},
			"ca_storage_locations.parent.preferred_labels.name":{},
			"yleisnimi" : {"convertCodesToDisplayText": true},
			"type_id" : {"convertCodesToDisplayText": true},
			"ca_object_representations.media.medium" : {}
		}
	}

	var paging = ca.getPaging(ctx);
	var url = config.collectiveaccess.url + "/service.php/find/ca_" + ctx.params.table + "?q=" + encodeURIComponent(ctx.query.q) + paging + "&pretty=1&authToken=" + ctx.session.user.token;
	debug('QUERY: ' + ctx.params.table + ' | ' + ctx.query.q)
	debug(url)
	try {
		var result = await requestp(url + cacheRand(), {json:adv})
		console.log('total: ' + result.total)
		ctx.body = result;
	} catch(e) {
		if(e.statusCode) ctx.status = e.statusCode;
		else e.status = 500;
		ctx.body = {error: e};
	}
})

router.get('/api/ca/searchforms', async function(ctx) {
	var forms = await ca.getSearchForms();
	ctx.body = forms;
})


router.get('/api/ca/searchforms/:form_code', async function(ctx) {
	var forms = await ca.getSearchForm(ctx.params.form_code);
	ctx.body = forms;
})

router.get('/api/ca/idno/lots/:lot_id', async function(ctx) {
	// get next free IDNO
	var next = await ca.getNextIDNO(ctx.params.lot_id, ctx.query.type)
	ctx.body = next;
})



/*********************************************************************************
 *  					browse (facets)
 * *******************************************************************************/

router.get('/api/ca/browse/:table', async function(ctx) {
	var result = {};
	var available_facets = {};
	var url = config.collectiveaccess.url + "/service.php/browse/ca_"+ctx.params.table+"?&pretty=1&authToken=" + ctx.session.user.token + "&limit=100";

	// if there is query, then make search with criteria
	if(Object.keys(ctx.query).length) {
		var facets = {}
		for(var query in ctx.query) {
			facets[query] = ctx.query[query].split(',')
		}
		available_facets = await requestp(url, {
			method: "OPTIONS",json:{
				criteria: facets
			}
		})
		result = await requestp(url, {
			method: "GET",json:{
				criteria: facets,
				bundles: {
					"idno" : {},
					//"ca_object_lots.preferred_labels" : {},
					//"ca_object_representations.original_filename": {},
					"ca_object_representations.media": {}
				}
			}
		})
	// else shwow available facets
	} else {
		available_facets = await requestp(url, {method:"OPTIONS", json: true})
	}

	ctx.body = {facets: available_facets, result: result};

})

/*********************************************************************************
 *  					edit logs
 * *******************************************************************************/

router.get('/api/ca/changes', async function(ctx) {
	ctx.body = await ca.getChanges('ca_objects', 'U', ctx)
})


/*********************************************************************************
 *  					forms (screens + models)
 * *******************************************************************************/

router.get('/api/ca/forms', async function(ctx, next) {
	var where = ""
	if(ctx.query.table) {
		where = " WHERE ui.editor_type = 57" // TODO!!
	}
	var sql = "select ui.ui_id, ui.editor_code, ui.editor_type,label.name, label.locale_id, label.description, locale.language,  locale.country FROM ca_editor_uis ui INNER JOIN ca_editor_ui_labels label ON label.ui_id = ui.ui_id INNER JOIN ca_locales locale ON label.locale_id = locale.locale_id " + where + ";";
	var forms = await makeQuery(sql);
	ctx.body = groupFormsBy(forms, 'editor_code');

})



router.get('/api/ca/forms/:form', async function(ctx, next) {

	var sql = "select ui.ui_id, ui.editor_code, ui.editor_type,label.name, label.locale_id, label.description, locale.language,  locale.country FROM ca_editor_uis ui INNER JOIN ca_editor_ui_labels label ON label.ui_id = ui.ui_id INNER JOIN ca_locales locale ON label.locale_id = locale.locale_id WHERE ui.editor_code = '" + ctx.params.form + "';"
	var forms = await makeQuery(sql);
	var grouped = groupFormsBy(forms, 'editor_code');
	for(var form in grouped) {
		console.log(grouped[form].type)
		var url = config.collectiveaccess.url + "/service.php/model/" + grouped[form].type + "?pretty=1&authToken=" + ctx.session.user.token;
		var result = await requestp(url)
		var models = JSON.parse(result)
		grouped[form].models = []
		for(var model in models) {
			grouped[form].models.push(model)
		}
	}
	//ctx.body = groupFormsBy(forms, 'editor_code');
	ctx.body = grouped;

})



router.get('/api/ca/forms/:form/models/:model', async function(ctx, next) {

	try {
		var result = await ca.getInputFormAndModel(ctx, ctx.params.form, ctx.params.model);
		ctx.body = result;
	} catch(e) {
		throw(e)
	}
})


/*
router.put('/api/ca/object_lots/:id/:type', async function(ctx) {
	var url = config.collectiveaccess.url + "/service.php/item/" + ctx.params.type + "?pretty=1&authToken=" + ctx.session.user.token
	var result = await requestp(url, {method: "PUT",json:{intrinsic_fields: {type_id: 91}}})
	ctx.body = result;

})
*/



/*********************************************************************************
 *  					files
 * *******************************************************************************/

/*
 *
 * - re-name file
 * - move to nfsdata/data/ca_media
 * - if image -> generate smaller jpg -> copy jpg to CA's import directory (
 * - if PDF -> copy original file to CA's import directory
 * - call object representation API
 *
 */

router.post('/api/ca/objects/:id/upload', async function(ctx, next) {
	
	var result = await media.uploadFile(ctx)
	ctx.body = result

});


// get file
router.get('/api/ca/files/:dir/:file', async function(ctx) {
	if(parseInt(ctx.params.dir) || ctx.params.dir === 'luetteloimaton') {
		var file = path.join('/files', ctx.params.dir, ctx.params.file);
		debug(file)
		ctx.body = fs.createReadStream(file)
	} else {
		throw('illegal path')
	}
})

/*********************************************************************************
 *  					NEXTCLOUD
 * *******************************************************************************/

// generate all previews
router.get('/api/nc/previews/:dir', async function(ctx) {
	//if(!ctx.query.dir) var dir = rootDir
	var dir = path.join(rootDir, ctx.params.dir);

	debug("processing " + dir)
	var files = [];
	try {
		files = await client.getDirectoryContents(dir);
		var previews = path.join(dir, "_previews");
		try {
			const stat = await client.getDirectoryContents(previews);
		} catch(e) {
			debug("ei preview -hakemistoa")
			await client.createDirectory(previews);
		}

		var processed = [];

		for(var file of files) {
			if(file.mime == "image/jpeg" || file.mime == "image/png") {
				debug(file.filename)
				try {
					await client.stat(path.join(previews, file.basename));
				} catch(e) {
					await createPreview(dir, file.basename)
					var imageBuffer = await fsPromises.readFile(path.join("public/preview", file.basename))
					await client.putFileContents(path.join(previews, file.basename), imageBuffer, { overwrite: false });
					processed.push(file.basename);
				}
			}
		}
		ctx.body = processed;

	} catch (e) {
		throw(e)
	}

})



// get preview file
router.get('/api/nc/previews/:dir/:file', async function(ctx) {
	var file = path.join(rootDir, ctx.params.dir, "_previews", ctx.params.file);
	debug(file)
	ctx.body = client.createReadStream(file)
})



// get contents of directory under root directory
router.get('/api/nc/files/:dir', async function(ctx) {
	if(ctx.params.dir == "root") var dir = rootDir
	else var dir = path.join(rootDir, ctx.params.dir);
	var files = []
	var dirs = []
	debug(dir)
	var contents = await client.getDirectoryContents(dir);
	for(var content of contents) {
		if(content.type == "file") {
			content.path = content.filename.replace("/" + content.basename, "");
			content.path = content.path.replace(rootDir, "");
			files.push(content)
		} else if(content.type == "directory" && content.basename != "_previews") dirs.push(content)
	}
	ctx.body = {files:files, dirs:dirs}
})



// get file
router.get('/api/nc/files/:dir/:file', async function(ctx) {
	var file = path.join(rootDir, ctx.params.dir, ctx.params.file);
	debug(file)
	ctx.body = client.createReadStream(file)
})



// transfer file to CollectiveAccess
router.get('/api/nc/transfer/:dir/:file/ca', async function(ctx) {
	var file = path.join(rootDir, ctx.params.dir, ctx.params.file);
	console.log("kopioidaan " + file + " CollectiveAccesin import -hakemistoon...")

	const resizer =
	  sharp()
		.resize(config.image.usage.width, config.image.usage.height)
		.jpeg();

	await pipeline (
		client.createReadStream(file),
		resizer,
		fs.createWriteStream(path.join(config.volume, ctx.params.file))
	);
	ctx.body = {file:file}
})



// transfer file to OSCARI -directory
router.post('/api/nc/transfer/:dir/:file/nc', async function(ctx) {
	if(!ctx.query.target || !ctx.query.name) throw("target ja name pitää antaa")
	try {
		var file = path.join(rootDir, ctx.params.dir, ctx.params.file);
		var targetfile = path.join("/OSCARI", ctx.query.target, ctx.query.name);
		console.log("siirretään " + file + " > " + targetfile)
		await client.copyFile(file, targetfile);
		ctx.body = {}
	} catch(e) {
		debug(e)
		throw("Tiedoston siirto ei onnistunut!")
	}

})





//// make preview
//router.get('/api/files/:dir*/:file/preview', async function(ctx) {
	//console.log("tehdään pikkukuva " + ctx.params.file + " ...")
	//if(!ctx.params.dir) var dir = rootDir
	//else var dir = rootDir + ctx.params.dir;

	//const roundedCorners = Buffer.from(
	  //'<svg><rect x="0" y="0" width="200" height="200" rx="50" ry="50"/></svg>'
	//);

	//const roundedCornerResizer =
	  //sharp()
		//.resize(200, 200)
		//.jpeg();


	//await pipeline (
		//client.createReadStream(path.join(dir, ctx.params.file)),
		//roundedCornerResizer,
		//fs.createWriteStream(path.join("public/preview", ctx.params.file))
	//);
	//ctx.body = {}
//})

async function createPreview(dir, file) {

	//const roundedCorners = Buffer.from(
	  //'<svg><rect x="0" y="0" width="200" height="200" rx="50" ry="50"/></svg>'
	//);

	const roundedCornerResizer =
	  sharp()
		.resize(config.image.preview.width, config.image.preview.height)
		.jpeg();


	await pipeline (
		client.createReadStream(path.join(dir,file)),
		roundedCornerResizer,
		fs.createWriteStream(path.join("public/preview", file))
	);

}

async function loadConfig() {
	console.log('reading...')
	try {
		const file = await fsPromises.readFile('./config.json', 'utf8');
		console.log('done')
		config = JSON.parse(file);
		// override defaults with env variables
		if(process.env.CA_URL) config.collectiveaccess.url = process.env.CA_URL;
		if(process.env.CA_IMPORT) config.collectiveaccess.import_path = process.env.CA_IMPORT;
		if(process.env.CA_AUTH) config.authentication = process.env.CA_AUTH;
	} catch(e) {
		console.log('config file not found!')
		process.exit(1);
	}
}


app.use(router.routes())

init();

function isValidUser(ctx) {

	if(config.authentication == 'shibboleth' || config.authentication == 'dummyUser') {
		const user = ctx.get(config.shibboleth.headerId);
		console.log(user)
		if(user in config.shibboleth.users) {
			if(ctx.session && ctx.session.user && ctx.session.user.username == config.shibboleth.users[user].ca_username) {
				return true;
			} else {
				throw({message: 'et ole kirjautunut', status: 401})
			}
		} else {
			throw('ei oikeuksia')
		}
	} else if(config.authentication == 'collectiveaccess') {
		if(ctx.session.user) return true;
		else return false;
	}

}


function makeDb( dbconfig ) {
  const connection = mysql.createConnection( dbconfig );  return {
    query( sql, args ) {
      return util.promisify( connection.query )
        .call( connection, sql, args );
    },
    close() {
      return util.promisify( connection.end ).call( connection );
    }
  };
}



async function makeQuery(sql) {
	var dbconfig = {};
	dbconfig.host = process.env.DB_HOST;
	dbconfig.user = process.env.DB_USER;
	dbconfig.password = process.env.DB_PW;
	dbconfig.database = process.env.DB_NAME;
	const db = makeDb(dbconfig);
	var items = null;
	try {
	  items = await db.query(sql);
	} catch ( err ) {
	  // handle the error
	  items = {error: err}
	} finally {
	  await db.close();
	}
	return items;
}

function groupFormsBy(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			obj.type = getTableName(obj.editor_type)
			acc[key] = {id: obj.ui_id, type:obj.type, labels:[]}
		}
		acc[key].labels.push({name:obj.name, language: obj.language, country: obj.country})
		return acc
	}, {})
}



function groupBy(objectArray, property, container) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {id: obj.list_id}
			acc[key][container] = []
		}
		acc[key][container].push(obj)
		return acc
	}, {})
}


function setTableNames(arr, table_num) {
	var arr2 = arr.map(function(obj) {
		obj[table_num] = getTableName(obj[table_num])
		return obj;
	})
	return arr2;
}

function getTableName(table_num) {
	var table_name = ''
	for(var table in TABLES) {
		if(TABLES[table] === table_num) table_name = table;
	}
	if(!table_name) table_name = table_num;
	return table_name;
}

function getLocale(ctx) {
	return 'FI_fi' // TODO: HARDCODED!!!
	var locale = config.shibboleth.users[ctx.get(config.shibboleth.headerId)].locale; // user's default locale from config
	var lang_code = locale.split('_')
	if(lang_code.length != 2) throw("Invalid language code");
	return locale;
}

function cacheRand() {
	return "&rand=" + Math.floor(Math.random() * Math.floor(100000));
}

async function init() {
	await loadConfig();
	ca = new CA(config);
	await ca.init();
	media = new Media(config, ca)


	// create webdav client
	client = createClient(
		config.nextcloud.url,
		{
			username: config.nextcloud.username,
			password: config.nextcloud.password
		}
	);

	// start the show
	var server = app.listen(8080, function () {
	   var host = server.address().address
	   var port = server.address().port
	   console.log('SIIRI at http://%s:%s', host, port)
	})
}
