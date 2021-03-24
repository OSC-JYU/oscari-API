const util 			= require('util');
const mysql			= require('mysql')
const sharp			= require('sharp');
const path 			= require('path');
const stream 		= require('stream');
const fs 			= require('fs');
const fsPromises 	= require('fs').promises;

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


	async uploadFile(ctx, type) {

		var allowed_formats = ['tiff', 'tif','jpg', 'jpeg', 'png', 'pdf', 'mp3', 'mp4', 'wav', 'ogg']
		var replace_table = {
			'ä':'a',
			'Ä':'A',
			'ö':'o',
			'Ö':'O',
			'å':'a',
			'Å':'A'

		}
		var sanitize = require("sanitize-filename");
		var os = require("os")

		var options = {
			fileName: '',
			filePath: '',
			fullPath: '',
			related_to: {item: null, table: '', id_name: ''},
			token:ctx.session.user.token
		}

		var body = {}
		var result = {}

		// create filename and check extension
		var oscariFilePath = null
		const file = ctx.request.files.file; // uploaded file
		var filename = file.name.replace(/[ÄÖÅäöå]/g, (char) => replace_table[char] || ''); // scandic characters causes problems to CA so they are replaced
		filename = sanitize(filename)
		var splitted = filename.split('.')
		var extension = splitted[splitted.length - 1].toLowerCase()
		debug(filename)
		if(!allowed_formats.includes(extension)) throw('Invalid file format')

		filename = filename.replace(/ /g, '_')

		if(type == 'object') {
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

			filename = item.idno + '_' + filename
			oscariFilePath = path.join('/files', item.lot_id.toString())

			options.related_to.item = item
			options.related_to.item_id_name = 'object_id'
			options.related_to.table = 'ca_objects'

		} else if(type == 'object_lots') {
			filename = ctx.params.id + '_' + filename
			oscariFilePath = path.join('/files', ctx.params.id)

			options.related_to.item = {}
			options.related_to.item.lot_id = ctx.params.id
			options.related_to.item_id_name = 'lot_id'
			options.related_to.table = 'ca_object_lots'
		}

		if(!oscariFilePath) throw("UploadPath not set for " + type)

		// check that LOT dir does exist
		if (!fs.existsSync(oscariFilePath)) {
			console.log('no ' + oscariFilePath)
			fs.mkdirSync(oscariFilePath)
		}

		var target_file = path.join(oscariFilePath, filename)
		debug('OSCARI UPLOAD PATH: ' + target_file)

		options.fileName = filename
		options.filePath = oscariFilePath
		options.fullPath = target_file

		// check that file does not exist
		if (fs.existsSync(target_file)) {
			console.log('file exists')
			throw({message:'file exists', status: 409})
		} else {
			console.log('UPLOADing original file to ' + target_file)
			await pipeline (
				fs.createReadStream(file.path),
				fs.createWriteStream(target_file)
			);

			try {
				//await this.import2CA(item, filePath, filename, ctx, type)
				await this.import2CA(options, type, ctx)
			} catch(e) {
				console.log(e)
				throw('Collectiveaccess import failed!' + target_file + e)
			}
		}
		return result
	}



	//async import2CA(item, filePath, filename, ctx, type) {
	async import2CA(options, type, ctx) {
		var imported = null
		var image_extensions = ['tif', 'tiff', 'jpg', 'png','jpeg']

		var splitted = options.fileName.split('.')
		var extension = splitted[splitted.length - 1].toLowerCase()

		// PREVIEWS IMAGE FILES
		if(image_extensions.includes(extension)) {
			try {
				imported = await this.importImage(options, ctx)
			} catch(e) {
				// if we failed, then we must remove uploaded file from /files
				console.log(e)
				try {
					console.log('removing file: ' + options.fullPath)
					fs.unlinkSync(options.fullPath)
					//file removed
				} catch(err) {
					console.error(err)
				}
				throw(e)
			}
		// PREVIEWS PDF FILES
		} else if (extension === 'pdf') {
			try {
				//imported = await this.importPDF(item, filePath, filename, ctx)
				imported = await this.importPDF(options, ctx)
			} catch(e) {
				// if we failed, then we must remove uploaded file from /files
				console.log(e)
				try {
					console.log('removing file: ' + options.fullPath)
					fs.unlinkSync(options.fullPath)
					//file removed
				} catch(err) {
					console.error(err)
				}
				throw(e)
			}
		}

		// write file link to object item also (TODO: this is only necessary if there is no object representation object)
		if(type == 'object') {
			try {
				//imported = await this.writeExternalMediaInfo(item, filePath, filename, ctx)
				imported = await this.writeExternalMediaInfo(options, ctx)
			} catch(e) {
				// if we failed, then we must remove uploaded file from /files
				console.log(e)
				try {
					console.log('removing file: ' + options.fullPath)
					fs.unlinkSync(options.fullPath)
					//file removed
				} catch(err) {
					console.error(err)
				}
				throw(e)
			}
		}

		return imported
	}


	// create smaller image to CA's import directory and imports it to CA
	async importImage(options, ctx) {
		var result = null
		console.log('Creating preview file to /import')
		const resizer =
		  sharp()
			.resize(this.config.image.usage.width, this.config.image.usage.height)
			.jpeg();

		resizer.options.limitInputPixels = 0
		await pipeline (
			fs.createReadStream(options.fullPath),
			resizer,
			fs.createWriteStream(path.join('/import', options.fileName))  // imported file is always .jpg
		);
		// add file to CollectiveAccess via API
		try {
			//result = await this.ca.createRepresentation(this.config.collectiveaccess.import_path, filename,  filePath, item.id, ctx.session.user.token)
			result = await this.ca.createRepresentation(options)
			// remove file from CA import dir
			try {
			  fs.unlinkSync(path.join('/import', options.fileName))
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


	async importPDF(options, ctx) {

		var result = null
		console.log('Copying PDF file to /import')
		await pipeline (
			fs.createReadStream(options.fullPath),
			fs.createWriteStream(path.join('/import', options.fileName))
		);
		// add file to CollectiveAccess via API
		try {
			result = await this.ca.createRepresentation(options)
			// remove file from CA import dir
			try {
			  fs.unlinkSync(path.join('/import', options.fileName))
			  //file removed
			} catch(err) {
				console.error(err)
			}
		} catch(e) {
			console.log(e)
		}
		return result
	}



	async writeExternalMediaInfo(options, ctx) {
		console.log('Writing external media info')
		var exists = false
		var rows = []
		var result = null
		// check if fullPath exists and if not, add current fullPath
		if(options.related_to.item.elements.external_media && options.related_to.item.elements.external_media.data) {
			for(var row of options.related_to.item.elements.external_media.data) {
				if(row.external_media_filename.value === options.fullPath) {
					exists = true
				}
				rows.push({'external_media_filename': row.external_media_filename.value})
			}
		}

		if(exists) throw('External file exists')
		rows.push({'external_media_filename': options.fullPath})

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

	async setPrimary(re_table, id_name, item_id, media_id) {
		// set is_primary to 0 for all
		var sql = "UPDATE " + rel_table + " SET is_primary = 0 where " + id_name + " = ?;"
		var reset = await this.makeQuery(sql, item_id);
		sql = "UPDATE " + rel_table + " SET is_primary = 1 where " + id_name + " = ? AND representation_id = ?;"
		var update = await this.makeQuery(sql, item_id, media_id);
	}

}

module.exports = Media;

function getLocale(ctx) {
	return 'FI_fi' // TODO: HARDCODED!!!
}
