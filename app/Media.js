const util 			= require('util');
const mysql			= require('mysql')
const sharp			= require('sharp');
const path 			= require('path');
const stream 		= require('stream');
const fs 			= require('fs');
const fsPromises 	= require('fs').promises;
const requestp		= require('request-promise-native');

// these are needed for reading CA screen settings
var Base64 			= require('js-base64').Base64;
var PHPUnserialize 	= require('php-unserialize');

var debug			= require('debug')('debug');
var error			= require('debug')('error');

const pipeline = util.promisify(stream.pipeline);

const SINGULARS = {
	'ca_objects': 'object',
	'ca_entities': 'entity',
	'ca_occurrences': 'occurrence',
	'ca_collections': 'collection',
	'ca_storage_locations': 'storage_location',
	'ca_object_lots': 'object_lot'
}


// from https://github.com/collectiveaccess/providence/blob/master/app/conf/datamodel.conf
const TABLES = {
	"ca_attribute_values":			 3,
	"ca_attributes":				 4,
	'ca_collections': 				13,
	'ca_entities': 					20,
	'ca_entity_labels': 			25,
	'ca_lists': 					36,
	'ca_lists': 					36,
	'ca_object_labels': 			50,
	'ca_object_lots': 				51,
	'ca_object_lots_x_entities':	53,
	'ca_object_representations':	56,
	'ca_objects': 					57,
	'ca_objects_x_entities': 		59,
	'ca_objects_x_objects': 		62,
	'ca_objects_x_occurrences': 	63,
	'ca_objects_x_places': 			64,
	"ca_occurrence_labels":			66,
	'ca_occurrences': 				67,
	'ca_places': 					72,
	"ca_storage_location_labels":	88,
	'ca_storage_locations': 		89,
	'ca_objects_x_storage_locations': 119
}


class Media {
	constructor(config, ca) {
		this.config = config
		this.ca = ca
	}

	async init() {
		console.log("Initialising Media module...")

		console.log("Initialising Media module... DONE")
	}


	async uploadFile(ctx) {

		var sanitize = require("sanitize-filename");
		var os = require("os")

		var body = {}
		// get item data (idno, lot_id)
		var item = null;
		try {
			var item = await this.ca.getItem("ca_objects", ctx.params.id, getLocale(ctx))
		} catch(e) {
			ctx.body = {error: e};
			ctx.status = 500
			console.log(e)
			throw(e)
		}

		// create filename
		const file = ctx.request.files.file;
		var filename = sanitize(file.name)
		filename = filename.replace(/ /g, '_')
		filename = item.idno + '_' + filename
		var uploadPath = path.join('/files', item.lot_id.toString())
		var filePath = path.join(uploadPath, filename)
		debug('UPLOAD PATH: ' + filePath)


		// check that LOT dir does exist
		if (!fs.existsSync(uploadPath)) {
			console.log('no ' + uploadPath)
			fs.mkdirSync(uploadPath)
		}

		// check that file does not exist
		if (fs.existsSync(filePath)) {
			console.log('file exists')
			ctx.status = 409
			ctx.body = {error: 'file exists'}
			return
		} else {
			console.log('UPLOADing original file to /files/' + filename)
			await pipeline (
				fs.createReadStream(file.path),
				fs.createWriteStream(filePath)
			);

			// copy file to import dir of CA
			var extensions = ['tif', 'tiff', 'jpg', 'png','jpeg']
			var splitted = filename.split('.')
			if(extensions.includes(splitted[splitted.length - 1].toLowerCase())) {
				console.log('Creating preview file to /import')
				await pipeline (
					fs.createReadStream(filePath),
					fs.createWriteStream(path.join('/import', filename))
				);
				// add file to CollectiveAccess via API
				var result = await this.ca.createRepresentation(this.config.collectiveaccess.import_path, filename,  filePath, item.id, ctx.session.user.token)

				// remove file from CA import dir
				try {
				  fs.unlinkSync(path.join('/import', filename))
				  //file removed
				} catch(err) {
					console.error(err)
				}
			}

			ctx.body = result
		}
	}


}

module.exports = Media;

function getLocale(ctx) {
	return 'FI_fi' // TODO: HARDCODED!!!
}
