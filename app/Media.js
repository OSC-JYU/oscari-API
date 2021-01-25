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

		var allowed_formats = ['tiff', 'tif','jpg', 'jpeg', 'png', 'pdf', 'mp3', 'mp4', 'wav', 'ogg']
		var sanitize = require("sanitize-filename");
		var os = require("os")

		// create filename and check extension
		const file = ctx.request.files.file;
		var filename = sanitize(file.name)
		var splitted = filename.split('.')
		var extension = splitted[splitted.length - 1].toLowerCase()
		debug(filename)
		if(!allowed_formats.includes(extension)) throw('Invalid file format')


		var body = {}
		var result = {}
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
			throw({message:'file exists', statusCode: 409})
		} else {
			console.log('UPLOADing original file to /files/' + filename)
			await pipeline (
				fs.createReadStream(file.path),
				fs.createWriteStream(filePath)
			);
			
			try {
				await this.import2CA(item, filePath, filename, ctx)
			} catch(e) {
				console.log(e)
				throw('Collectiveaccess import failed!' + filename + e)
			}
		}
		return result
	}



	async import2CA(item, filePath, filename, ctx) {
		var imported = null
		var image_extensions = ['tif', 'tiff', 'jpg', 'png','jpeg']
		
		var splitted = filename.split('.')
		var extension = splitted[splitted.length - 1].toLowerCase()

		try {
			imported = await this.writeExternalMediaInfo(item, filePath, filename, ctx)
		} catch(e) {
			// if we failed, then we must remove uploaded file from /files
			console.log(e)
			try {
				console.log('removing file: ' + filePath)
				fs.unlinkSync(filePath)
				//file removed
			} catch(err) {
				console.error(err)
			}
			throw(e)
		}

		// PREVIEWS IMAGE FILES
		if(image_extensions.includes(extension)) {
			try {
				imported = await this.importImage(item, filePath, filename, ctx)
			} catch(e) {
				// if we failed, then we must remove uploaded file from /files
				console.log(e)
				try {
					console.log('removing file: ' + filePath)
					fs.unlinkSync(filePath)
					//file removed
				} catch(err) {
					console.error(err)
				}
				throw(e)
			}
		// PREVIEWS PDF FILES
		} else if (extension === 'pdf') {
			try {
				imported = await this.importPDF(item, filePath, filename, ctx)
			} catch(e) {
				// if we failed, then we must remove uploaded file from /files
				console.log(e)
				try {
					console.log('removing file: ' + filePath)
					fs.unlinkSync(filePath)
					//file removed
				} catch(err) {
					console.error(err)
				}
				throw(e)
			}
		} 

		return imported
	}



	async importImage(item, filePath, filename, ctx) {
		var result = null
		console.log('Creating preview file to /import')
		const resizer =
		  sharp({limitInputPixels: false})
			.resize(this.config.image.usage.width, this.config.image.usage.height)
			.jpeg();
		await pipeline (
			fs.createReadStream(filePath),
			resizer,
			fs.createWriteStream(path.join('/import', filename))
		);
		// add file to CollectiveAccess via API
		try {
			result = await this.ca.createRepresentation(this.config.collectiveaccess.import_path, filename,  filePath, item.id, ctx.session.user.token)
			// remove file from CA import dir
			try {
			  fs.unlinkSync(path.join('/import', filename))
			  //file removed
			} catch(err) {
				console.error(err)
			}
		} catch(e) {
			console.log('Collectiveaccess media import failed', e)
			throw('Poista minut')
		}


		return result
	}


	async importPDF(item, filePath, filename, ctx) {
		var result = null
		console.log('Copying PDF file to /import')
		await pipeline (
			fs.createReadStream(filePath),
			fs.createWriteStream(path.join('/import', filename))
		);
		// add file to CollectiveAccess via API
		try {
			result = await this.ca.createRepresentation(this.config.collectiveaccess.import_path, filename,  filePath, item.id, ctx.session.user.token)
			// remove file from CA import dir
			try {
			  fs.unlinkSync(path.join('/import', filename))
			  //file removed
			} catch(err) {
				console.error(err)
			}
		} catch(e) {
			
		}
		return result
	}



	async writeExternalMediaInfo(item, filePath, filename, ctx) {
		console.log('Writing external media info')
		var exists = false
		var rows = []
		var result = null
		if(item.elements.external_media && item.elements.external_media.data) {
			for(var row of item.elements.external_media.data) {
				if(row.external_media_filename.value === filePath) {
					exists = true
				}
				rows.push({'external_media_filename': row.external_media_filename.value})
			}
		}
		
		if(exists) throw('External file exists')
		rows.push({'external_media_filename': filePath})
		
		var edit = {'attributes': 
			{'external_media': rows}
		}
		try {
			result = await this.ca.editItem("ca_objects", ctx.params.id, edit, ctx.session.user.token, ctx.session.user.user_id);
		} catch(e) {
			throw("Object editing failed!", e)
		}
		return result
	}

}

module.exports = Media;

function getLocale(ctx) {
	return 'FI_fi' // TODO: HARDCODED!!!
}
