const util 			= require('util');
const mysql			= require('mysql')
const requestp		= require('request-promise-native');

// these are needed for reading CA screen settings
var Base64 			= require('js-base64').Base64;
var PHPUnserialize 	= require('php-unserialize');

var debug			= require('debug')('debug');
var debug_sql		= require('debug')('debug_sql');
var error			= require('debug')('error');

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

// providence/app/conf/attribute_types.conf
const ELEMENTTYPES = {
	"0": "container",
	"1": "text",
	"2": "daterange",
	"3": "list",
	"4": "geocode",
	"5": "url",
	"6": "currency",
	"8": "length",
	"9": "weight",
	"10": "timecode",
	"11": "integer",
	"12": "numeric",
	"13": "lcsh",
	"14": "geonames",
	"15": "file",
	"16": "media",
	"19": "taxonomy",
	"20": "informationservice",
	"31": "floorplan",
	"32": "color"
}



class CA {
	constructor(config) {
		this.config = config
	}

	async init() {
		console.log("Initialising CollectiveAccess module...")
		// get all metadata elements with translations
		this.elements = await this.getMetadataElements();
		this.locales = await this.getLocaleValues();
		this.status = await this.getStatuses();

		//this.relations = await this.getRelationships();
		//console.log(this.relations)
		console.log("Initialising CollectiveAccess module... DONE")
	}

	getElements() {
		return this.elements;
	}

	getLocales() {
		return this.locales;
	}

	async getUserId(username) {
		var sql = "SELECT user_id FROM ca_users WHERE user_name = ?";
		var user = await this.makeQuery(sql, username)
		if(Array.isArray(user) && user.length == 1) return user[0].user_id;
		else throw({msg:"User not found", statusCode: 401})

	}


	async getLists() {
		var sql = "select list.list_code, list.list_id, label.name, CONCAT(language,'_',country) AS locale FROM ca_lists list INNER JOIN ca_list_labels label ON list.list_id = label.list_id INNER JOIN ca_locales locale ON label.locale_id = locale.locale_id;"
		var lists = await this.makeQuery(sql)
		return groupListsBy(lists, 'list_code');
	}


	async getSets(user_id) {
		var sql = "select sets.set_code, sets.set_id, label.name, CONCAT(language,'_',country) AS locale FROM ca_sets sets INNER JOIN ca_set_labels label ON sets.set_id = label.set_id INNER JOIN ca_locales locale ON label.locale_id = locale.locale_id WHERE user_id = ? AND deleted = 0 ORDER BY label.name;"
		var sets = await this.makeQuery(sql, user_id)
		return groupSetsBy(sets, 'set_code');
	}


	async getSet(code) {
		var out = {}
		var sql = "SELECT set_id, set_code FROM ca_sets WHERE set_code = ?";
		var set_id = await this.makeQuery(sql, code);
		if(Array.isArray(set_id) && set_id.length == 1) {
			out.code = code
			var sql = "SELECT item_id, row_id, table_num FROM ca_set_items WHERE set_id = ? AND deleted = 0";
			var items = await this.makeQuery(sql, set_id[0].set_id);
			out.count = items.length
			out.items = items
			// let's map table nums to table names
			for(var item of out.items) {
				//item.type = getTableName(item.table_num)
				item.media = await this.getMedia(item.row_id);
				item.labels = await this.getItemLabels('ca_objects', item.row_id)
				//item.data = await this.getItem(item.type, item.row_id, 'FI_fi')
			}
			return out;
		}
	}


	async createSet(body, table, locale, ctx) {
		var data = body
		if(typeof body == 'string') data = JSON.parse(body)
		console.log(data.name)
		if(!data.name) throw('Setin nimi pitää antaa')
		var sanitize = require("sanitize-filename");
		var clean_name = sanitize(data.name)
		clean_name = clean_name.replace(/ /g, '_')
		var table_num = TABLES[table]
		// values = [user_id, set_code, table_num] objects only
		var values = [ctx.session.user.user_id, clean_name, 57]
		var search = await this.makeQuery("SELECT set_code FROM ca_sets WHERE set_code = ?", [clean_name]);
		if(search.length) throw({message: 'Set called ' + clean_name + ' exists', status: 409})
		var sql = "INSERT INTO ca_sets (hier_set_id, user_id, type_id, commenting_status, tagging_status, rating_status, set_code, table_num, access, status, hier_left, hier_right, deleted, rank) VALUES (0,?,12,0,0,0,?,?,0,0,1.0,429.00,0,0);"
		try {
			await this.makeQuery(sql, values);
			var id = await this.makeQuery("select MAX(set_id) AS id FROM ca_sets", []);
			console.log(id)
			var set_id = id[0].id;
			await this.makeQuery("UPDATE ca_sets SET hier_set_id = set_id, rank = set_id WHERE set_id = LAST_INSERT_ID()", [])
			var label_values = [set_id, 1, data.name]
			var label_sql = "INSERT INTO ca_set_labels (set_id, locale_id, name) VALUES (?,?,?);"
			try {
				await this.makeQuery(label_sql, label_values);
				return set_id
			} catch(e) {
				debug(e)
				throw('creating set failed')
			}
		} catch(e) {
			debug(e)
			throw('creating set failed')
		}
	}

	async createSetItems(set_code, body, locale) {
		if(!set_code) throw({msg: "Can not create set item for non-existing set!", statusCode: 404})
		var data = body
		if(typeof body == 'string') data = JSON.parse(body)
		var sql = "SELECT set_id, set_code FROM ca_sets WHERE set_code = ?";
		var set_result = await this.makeQuery(sql, set_code);
		console.log(set_result)
		console.log(set_result.length)
		console.log(Array.isArray(set_result))
		if(Array.isArray(set_result) && set_result.length == 1) {
			var set_id = set_result[0].set_id
			if(data && Array.isArray(data)) {
				for(var item of data) {
					//set_id, table_num, row_id, type_id, rank, vars, deleted
					var values = [set_id, TABLES[item.table], item.id]
					console.log(values)
					try {
						var search = "SELECT item_id FROM ca_set_items WHERE set_id = ? AND table_num = ? AND row_id = ?"
						var search_result = await this.makeQuery(search, values);
						if(search_result.length == 0) {
							var sql = "INSERT INTO ca_set_items (set_id, table_num, row_id, type_id, rank, vars, deleted) VALUES (?,?,?,12,0,'',0)"
							var result = await this.makeQuery(sql, values);
							return result
						}
					} catch(e) {
						debug(e)
						throw('creating set item failed')
					}
				}
			}
		} else {
			throw('creating set item failed')
		}
	}

	async removeSetItem(set_code, item_id) {
		var sql = "SELECT set_id, set_code FROM ca_sets WHERE set_code = ?";
		var set_result = await this.makeQuery(sql, set_code);
		console.log(set_result)
		if(Array.isArray(set_result) && set_result.length == 1) {
			var set_id = set_result[0].set_id
			var values = [set_id, item_id]
			console.log(sql,values)
			var sql = "DELETE FROM ca_set_items WHERE set_id = ? and item_id = ?;"
			try {
				await this.makeQuery(sql, values);
			} catch(e) {
				debug(e)
				throw('removing set item failed')
			}
		}
	}

	async deleteSet(set_code, ctx) {
		// TODO: this should remove also set items and full delete should be optional
		try {
			var set_id = await this.getSetID(set_code, ctx.session.user.user_id)
			var values = [set_id, ctx.session.user.user_id]
			/*			
			var sql = "UPDATE ca_sets SET deleted = 1 WHERE set_id = ? and user_id = ?;"
			try {
				await this.makeQuery(sql, values);
			} catch(e) {
				debug(e)
				throw('removing set failed')
			}
*/
			var sql = "DELETE FROM ca_sets WHERE set_id = ? and user_id = ?;"
			try {
				await this.makeQuery(sql, values);
			} catch(e) {
				debug(e)
				throw('removing set failed')
			}

			var sql = "DELETE FROM ca_set_labels WHERE set_id = ?;"
			try {
				await this.makeQuery(sql, values);
			} catch(e) {
				debug(e)
				throw('removing set failed')
			}

		} catch(e) {
			debug(e)
			throw('removing set failed')
		}
	}

	async getSetID(set_code, user_id) {
		var sql = "SELECT set_id, set_code FROM ca_sets WHERE set_code = ? AND user_id = ?";
		var set_result = await this.makeQuery(sql, [set_code, user_id]);
		if(Array.isArray(set_result) && set_result.length == 1) {
			return set_result[0].set_id
		} else {
			throw('Settiä ' + set_code + ' ei löytynyt')
		}
	}

	// we need to get list IDs of status lists for objects and object_lots
	// ID is then inserted to a model
	async getStatuses() {
		var object_sql = "select list.list_code, list.list_id FROM ca_lists list  WHERE list.list_code = 'object_statuses';"
		var object_status_id = await this.makeQuery(object_sql)
		var lot_sql = "select list.list_code, list.list_id FROM ca_lists list  WHERE list.list_code = 'object_lot_statuses';"
		var lot_status_id = await this.makeQuery(lot_sql)
	}

	async getStorageLocations(parent) {
		if(!parent) parent = 1;

		var out = {}
		var values = [parent]

		// get parent also
		if(parent !== 1) {
			var parent_sql = "select name from ca_storage_location_labels WHERE location_id=?;"
			var parent_result = await this.makeQuery(parent_sql, values)
			out.parent =  parent_result[0].name
		}

		var sql = "select loc.location_id,idno,parent_id, name from ca_storage_locations loc INNER JOIN ca_storage_location_labels label ON label.location_id = loc.location_id where parent_id=? ORDER by idno;"
		out.location = await this.makeQuery(sql, values)

		return out
	}

	async getStorageLocationParent(location_id) {
		if(!location_id) return {}

		var out = {}
		var values = [location_id]

		// get parent
		var sql = "select name from ca_storage_location_labels WHERE location_id=?;"
		var result = await this.makeQuery(sql, values)
		if(result && result[0] && result[0].name)
			out.name =  result[0].name
		else
			out.name = ''

		return out
	}

	async getRelationships() {
		var sql = "select CONCAT(language,'_',country) AS locale, labels.locale_id, labels.typename, labels.typename_reverse, labels.description, labels.description_reverse,types.type_id, types.type_code from ca_relationship_types types INNER JOIN ca_relationship_type_labels labels ON  types.type_id = labels.type_id INNER JOIN ca_locales lo ON lo.locale_id = labels.locale_id;"
		var relations = await this.makeQuery(sql);
		return groupRelationsBy(relations, 'type_id');
	}


	async getList(list_id, locale) {
		if(!parseInt(list_id)) {
			var sql = "SELECT list_id FROM ca_lists WHERE list_code = ?"
			var items = await this.makeQuery(sql, [list_id])
			if(Array.isArray(items) && items.length == 1) list_id = items[0].list_id;
			else throw("List not found")
		}
		if(!locale) throw("Locale must be set")
		var lang_code = locale.split('_')
		if(lang_code.length != 2) throw("Invalid language code");
		var sql = "select CONCAT(language,'_',country) AS locale, is_default, name_singular AS text, item_value, l.item_id AS value FROM ca_list_item_labels l INNER JOIN ca_list_items i ON i.item_id = l.item_id INNER JOIN ca_locales lo ON lo.locale_id = l.locale_id  WHERE i.list_id = '" + list_id + "' and language = '" + lang_code[0] + "' AND country = '"+ lang_code[1] +"' ORDER BY name_singular;"
		debug_sql(sql)
		var items = await this.makeQuery(sql)
		return items;

	}


	async getListItem(list_id, item_id, locale) {

		var lang_code = locale.split('_');
		if(lang_code.length != 2) throw("Invalid language code");
		var sql = "select CONCAT(language,'_',country) AS locale, name_singular, item_value, l.item_id FROM ca_list_item_labels l INNER JOIN ca_list_items i ON i.item_id = l.item_id INNER JOIN ca_locales lo ON lo.locale_id = l.locale_id  WHERE i.list_id = '" + list_id + "' and language = '" + lang_code[0] + "' AND country = '"+ lang_code[1] +"' AND i.item_id = " + item_id + ";"
		var item = await this.makeQuery(sql);
		if(Array.isArray(item) && item.length == 1) return item[0].name_singular;
		else return item[0];
	}


	async getSearchForms() {
		var sql = "SELECT CONCAT(language,'_',country) AS locale,form.form_id, form_code, label.name FROM ca_search_forms form INNER JOIN ca_search_form_labels label ON form.form_id = label.form_id INNER JOIN ca_locales locale ON label.locale_id = locale.locale_id;"
		var forms = await this.makeQuery(sql);
		return groupSetsBy(forms, 'form_code');
	}


	async getSearchForm(form_code) {
		var output = {table: '', placements: []}
		var sql = "SELECT table_num FROM ca_search_forms WHERE form_code = ?";
		var form = await this.makeQuery(sql, [form_code]);
		if(Array.isArray(form) && form.length == 1)
			output.table = getTableName(form[0].table_num)
		else
			throw("Search form not found!")

		// restrictions
		var sql = "SELECT form.table_num, restr.type_id FROM ca_search_forms form INNER JOIN ca_search_form_type_restrictions restr ON form.form_id = restr.form_id WHERE form.form_code = ?;"
		output.restrictions = await this.makeQuery(sql, [form_code]);

		// metadata elements
		var sql = "SELECT p.bundle_name, p.settings FROM ca_search_form_placements p INNER JOIN ca_search_forms form ON form.form_id = p.form_id  WHERE form_code = ?;"
		debug_sql(sql)
		var placements = await this.makeQuery(sql, [form_code]);
		for(var pl of placements) {
			debug(pl)
			pl.settings = PHPUnserialize.unserialize(Base64.decode(pl.settings));
			var ele = pl.bundle_name.split('.')
			if(ele.length == 2 && !ele[0].includes('labels') && ele[1] != 'idno'  && ele[1] != 'idno_stub' && ele[1] != 'type_id') {
				var meta = await this.getMetadataElement(ele[1], 'getListValues');
				pl.elements = meta;
			// object types is a list and we must fetch list values
			} else if(ele[1] == 'type_id') {
				if(SINGULARS[output.table]) {
					var types = await this.getList(SINGULARS[output.table] + '_types', 'FI_fi');
					var l = {type: 'list', code: 'type_list', values: []}
					l.values = types;
					pl.elements = [l]
				}
			}
		}
		output.placements = placements;
		return output;

	}

	async getInputFormAndModel(ctx, form, model) {

		if(!form || !model) throw('Form and model must be set')
		console.log(model)
		// get form labels
		var sql = "select ui.ui_id, ui.editor_code, ui.editor_type,label.name, label.locale_id, label.description, locale.language,  locale.country FROM ca_editor_uis ui INNER JOIN ca_editor_ui_labels label ON label.ui_id = ui.ui_id INNER JOIN ca_locales locale ON label.locale_id = locale.locale_id WHERE ui.editor_code = '" + form + "';"
		var forms = await this.makeQuery(sql);
		var data = groupFormsBy(forms, 'editor_code');
		if(!data[form]) throw('Form not found')

		var table = data[form].type;
		var ui_id = data[form].id;
		console.log(ctx.session.user.token)
		// get models
		var url = this.config.collectiveaccess.url + "/service.php/model/" + table + "?pretty=1&authToken=" + ctx.session.user.token;
		console.log(url)
		var result = await requestp(url)
		var models = JSON.parse(result)
		if(!models[model]) throw('Model not found')
		data[form].screens = await this.getUIScreens(ui_id, models[model])
		data[form].relationship_types = models[model].relationship_types

		//ctx.body = models[ctx.params.model]
		return data[form]
	}


	async getItemFromAPI(table, id, token) {
		var url = this.config.collectiveaccess.url + "/service.php/item/" + table + "/id/" + id + "?pretty=1&authToken=" + token;
		var result = await requestp(url, {json:true})
		var item = {}

		item.id = result.object_id.value; // HARCDCODED(object_id): FIX THIS!
		item.idno = result.idno.value;
		item.type_id = result.type_id;
		item.preferred_labels = result.preferred_labels;
		item.elements = {}
		item.links = result.related;

		for(var key in result) {
			if(key.includes(table)) {
				var ele = key.replace(table + '.', '')
				item.elements[ele] = result[key];
			}
		}

		return item;
	}

	async getItemType(table, type_id) {
		var lists = await this.getLists();
		var list_id = lists[SINGULARS[table] + '_types'].id;
		var values = [list_id, type_id]
		var sql = "SELECT IDNO FROM ca_list_items WHERE list_id = ? AND item_id = ?;"
		var type = await this.makeQuery(sql, values)
		return type[0].IDNO
	}

	// direct database getter for items
	async getItem(table, id, locale) {

		var idno, lot_id = '';
		try {
			// get IDNO and lot_id
			var item = await this.getBaseInfo(table, id)
			if(item) {
				item.typename = await this.getItemType(table, item.type_id);
				item.id = id;
				item.table = table;
				item.elements = {}
				item.relations = {};
				// get labels
				var labels = await this.getItemLabels(table, id, locale);
				item.labels = labels;
				// get element values
				var values = await this.getAttributeValues(table, id);
				debug('********** METADATA VALUES ********** ')
				debug(values)
				debug('********** METADATA VALUES ENDs ********** ')
				// group elements by parent_id in order to get containers
				var containers = groupByElements(values, 'parent_id');


				// get elements without parent element and group by element_id (i.e. elements that are not part of container)
				var attributes = [];
				for(var it of values) {
					if(!it.parent_id) attributes.push(it);
				}

				var item_attributes = groupByElements(attributes, 'element_code');
				debug('********** ATTRIBUTES ********** ')
				debug(JSON.stringify(item_attributes))
				debug('********** ATTRIBUTES ENDS ********** ')


				// containers
				debug('********** CONTAINERS ********** ')
				if(table !== 'ca_storage_locations')
					await this.pickValues(containers, item, locale, true)
				//debug(containers)
				debug('********** CONTAINERS ENDS ****** ')
				// non-containers
				await this.pickValues(item_attributes, item, locale, false)
				debug(item.elements)

				// relations

				if(table == 'ca_objects') {
					item.media = await this.getMedia(id);
					item.relations.entities = await this.getRelations('ca_objects_x_entities', 'entity', 'object_id', 'entity_id', id, true);
					item.relations.collections = await this.getRelations('ca_objects_x_collections', 'collection', 'object_id', 'collection_id', id);
					item.relations.storage_locations = await this.getRelations('ca_objects_x_storage_locations', 'storage_location', 'object_id', 'location_id', id, true);
					item.relations.occurrences = await this.getRelations('ca_objects_x_occurrences', 'occurrence', 'object_id', 'occurrence_id', id, true);

				} else if(table == 'ca_entities') {
					item.relations.objects = await this.getRelations('ca_objects_x_entities', 'object', 'entity_id', 'object_id', id);
					item.relations.object_lots = await this.getRelations('ca_object_lots_x_entities', 'object_lot', 'entity_id', 'lot_id', id);
					item.relations.occurrences = await this.getRelations('ca_entities_x_occurrences', 'occurrence', 'entity_id', 'occurrence_id', id);

				} else if(table == 'ca_storage_locations') {
					item.relations.objects = await this.getRelations('ca_objects_x_storage_locations', 'object', 'location_id', 'object_id', id);

				} else if(table == 'ca_object_lots') {
					item.relations.entities = await this.getRelations('ca_object_lots_x_entities', 'entity', 'lot_id', 'entity_id', id, true);
					item.relations.objects = await this.getObjectsByLOT(id);
					item.object_count = await this.getLOTObjectCount(id);

				} else if(table == 'ca_collections') {
					item.relations.objects = await this.getRelations('ca_objects_x_collections', 'object', 'collection_id', 'object_id', id);

				} else if(table == 'ca_occurrences') {
					item.relations.entities = await this.getRelations('ca_entities_x_occurrences', 'entity', 'occurrence_id', 'entity_id', id, true);
					item.relations.objects = await this.getRelations('ca_objects_x_occurrences', 'object', 'occurrence_id', 'object_id', id);
				}

				return item;
			} else {
				return null
			}
		} catch(e) {
			throw({msg: "Could not get item " + id + " error: " + e.message, statusCode: 404})
		}


	}

	async getLOTObjectCount(lot_id) {
		var sql = "SELECT count(object_id) AS obj_count FROM ca_objects WHERE lot_id = " + lot_id
		var count = await this.makeQuery(sql);
		return count[0].obj_count
	}

	async getObjectsByLOT(lot_id, locale) {
		var items = []
		var sql = "SELECT object_id, type_id FROM ca_objects WHERE lot_id = " + lot_id + " LIMIT 50"
		var objects = await this.makeQuery(sql);
		for(var object of objects) {
			var item = await this.getBaseInfo('ca_objects', object.object_id)
			item.typename = await this.getItemType('ca_objects', item.type_id);
			item.labels = await this.getItemLabels('ca_objects', object.object_id, locale);
			items.push(item)
		}

		return items

	}

	async getRelations(table, label_table, from_name, to_name, id, with_rel_info = false) {

		var sql = ''
		var values = [id];
		var name = "name";
		var item_table = table.split('_x_')[0]
		if(label_table == 'entity') name = 'displayname';
		debug("getrelations: " + table, label_table)

		if(item_table == 'ca_objects'&& label_table == 'object') { // we want idno for objects
			sql = "SELECT item.idno, rel.relation_id, rel.type_id, rel." + to_name + ", label."+name+" FROM " + table + " rel INNER JOIN ca_" + label_table + "_labels label ON rel."+to_name+" = label."+to_name+"  INNER JOIN " + item_table + " item ON rel." + to_name + " = item." + to_name + " WHERE rel." + from_name + " = ? AND label.is_preferred = 1 ORDER BY item.idno LIMIT 50";
		} else if(item_table == 'ca_objects' && label_table == 'storage_location') { // we want parent_id for locations
			sql = "SELECT loc.parent_id, rel.relation_id, rel.type_id, rel." + to_name + ", label."+name+" FROM " + table + " rel INNER JOIN ca_" + label_table + "_labels label ON rel."+to_name+" = label."+to_name+" INNER JOIN ca_storage_locations loc ON rel." + to_name+ " = loc.location_id WHERE " + from_name + " = ? AND label.is_preferred = 1 ORDER BY label."+name + " LIMIT 50";
		} else {
			sql = "SELECT rel.relation_id, rel.type_id, rel." + to_name + ", label."+name+" FROM " + table + " rel INNER JOIN ca_" + label_table + "_labels label ON rel."+to_name+" = label."+to_name+"  WHERE " + from_name + " = ? AND label.is_preferred = 1 ORDER BY label."+name + " LIMIT 50";
		}
		debug_sql(sql)
		// get relations
		var relations = await this.makeQuery(sql, values);

		// get relationship data
		if(with_rel_info) {
			for(var r of relations) {
				console.log('relation_id: ' + r.relation_id)
				if(TABLES[table]) {
					var values = [TABLES[table], r.relation_id]
					var sql = "select value.value_longtext1 as info from ca_attribute_values value INNER JOIN ca_attributes attr ON value.attribute_id = attr.attribute_id WHERE attr.table_num = ? AND attr.row_id = ?";
					var info = await this.makeQuery(sql, values);
					if(info.length) r.relation_info = info[0].info;
				}
			}
		}

		// for storagelocation we want also parent label
		if(table == 'ca_objects_x_storage_locations') {
			if(relations.length == 1) {
				relations[0].parent = await this.getStorageLocationParent(relations[0].parent_id)
			}
		}

		// array of relation type ids
		var rels = groupRelationItemsBy(relations, 'type_id');
		var rel_arr = [];
		for(var rel in rels) {
			rel_arr.push(rel)
		}
		//console.log(rels)

		if(rel_arr.length) {
			// get locales for relation types
			var sql = "SELECT CONCAT(locale.country,'_',locale.language) as locale, type_id, typename FROM ca_relationship_type_labels label INNER JOIN ca_locales locale ON locale.locale_id = label.locale_id WHERE type_id in ("+rel_arr.join(',')+")"
			var labels = await this.makeQuery(sql, rel_arr);
			for(var rel in rels) {
				rels[rel].relation_labels = []
				for(var label of labels) {
					if(label.type_id == rel) rels[rel].relation_labels.push(label);
				}
			}
		}
		//var labels_grouped = groupBy(labels, 'type_id');
		return rels;
	}


	async getMedia(id, just_primary) {
		var out = []
		const zlib = require('zlib');
		var primary = " ORDER by is_primary";
		if(just_primary) primary = " WHERE is_primary = 1";
		var sql = "SELECT  is_primary, m.representation_id, media, mimetype, original_filename FROM  ca_objects_x_object_representations rel INNER JOIN  ca_object_representations m ON m.representation_id = rel.representation_id WHERE object_id = ? " + primary
		var representations = await this.makeQuery(sql, id);

		for(var representation of representations) {
			if(representation.media) {
				var media = {}
				var bin = representation.media;
				var unserialised  = PHPUnserialize.unserialize(zlib.inflateSync(Buffer.from(bin,'base64')))
				//media = unserialised
				media.representation_id = representation.representation_id
				media.is_primary = representation.is_primary
				media.labels = await this.getItemLabels('ca_object_representations', representation.representation_id)
				media.attributes = await this.getAttributeValues('ca_object_representations', representation.representation_id)
				media.preview = '/' + unserialised.preview.VOLUME + '/' + unserialised.preview.HASH + '/' + unserialised.preview.MAGIC + '_' + unserialised.preview.FILENAME
				media.tiny = '/' + unserialised.tiny.VOLUME + '/' + unserialised.tiny.HASH + '/' + unserialised.tiny.MAGIC + '_' + unserialised.tiny.FILENAME
				media.medium = '/' + unserialised.medium.VOLUME + '/' + unserialised.medium.HASH + '/' + unserialised.medium.MAGIC + '_' + unserialised.medium.FILENAME
				media.page = '/' + unserialised.preview.VOLUME + '/' + unserialised.page.HASH + '/' + unserialised.page.MAGIC + '_' + unserialised.page.FILENAME
				media.original = '/' + unserialised.original.VOLUME + '/' + unserialised.original.HASH + '/' + unserialised.original.MAGIC + '_' + unserialised.original.FILENAME
				out.push(media)
			}
		}
		return out;
	}

	async getBaseInfo(table, id) {
		var singularTable = SINGULARS[table]
		var table_id = singularTable + '_id';
		if(table == 'ca_storage_locations') table_id = 'location_id' // storage location id = location_id
		if(table == 'ca_object_lots') table_id = 'lot_id' // object lots id = lot_id
		if(table == 'ca_collections') table_id = 'collection_id' // object lots id = lot_id
		var sql_info = "select * from " + table + " WHERE " + table_id + " = ?;"
		var values = [id]
		debug_sql(sql_info)
		debug_sql('values: ' + values)
		try {
			var info = await this.makeQuery(sql_info, values);
			if(info && info[0]) return info[0]
			else return null
		} catch(e) {
			error(e)
			console.log(e)
		}
	}

	async getItemLabels(table, id, locale) {
		if(table == 'ca_storage_locations') { // storage location id = location_id
			var table_id = 'location_id';
			var label_table = 'ca_storage_location_labels';
		} else if(table == 'ca_object_lots') { // storage location id = location_id
			var table_id = 'lot_id';
			var label_table = 'ca_object_lot_labels';
		} else if(table == 'ca_object_representations') { // object representation id = representation_id
			var table_id = 'representation_id';
			var label_table = 'ca_object_representation_labels';
		} else {
			var singularTable = SINGULARS[table]
			var table_id = singularTable + '_id';
			var label_table = 'ca_' + singularTable + '_labels';
		}
		var sql_labels = "select CONCAT(language,'_',country) AS locale, label.name, label.is_preferred from " + table + " obj INNER JOIN " +label_table + " label ON label." + table_id + " = obj." + table_id + " INNER JOIN ca_locales  lo ON lo.locale_id = label.locale_id WHERE obj." + table_id + " = " + id + ";"

		// labels are different for entities
		if(table == 'ca_entities') {
			sql_labels = "select CONCAT(language,'_',country) AS locale, label.displayname, label.forename, label.surname, label.is_preferred from " + table + " obj INNER JOIN " +label_table + " label ON label." + table_id + " = obj." + table_id + " INNER JOIN ca_locales  lo ON lo.locale_id = label.locale_id WHERE obj." + table_id + " = " + id + ";"
		}
		debug_sql(sql_labels)
		var labels = await this.makeQuery(sql_labels);

		var labels_obj = {preferred_label: '', other_labels: []}
		for(var label of labels) {
			if(label.is_preferred == "1")
				labels_obj.preferred_label = label;
			else
				labels_obj.other_labels.push(label)
		}
		return labels_obj;
	}


	async getAttributeValues(table, id) {
		var sql = "select value_longtext1, val.attribute_id, val.element_id, attr.locale_id, element_code, parent_id, datatype, list_id FROM ca_attribute_values val INNER JOIN ca_attributes attr ON val.attribute_id = attr.attribute_id INNER JOIN ca_metadata_elements meta ON val.element_id = meta.element_id WHERE table_num = " + TABLES[table] + " AND row_id= "+id+";"
		debug_sql(sql)
		var item = await this.makeQuery(sql);
		return item;
	}


	async getChanges(table, action, ctx) {

		var table_num = TABLES[table];
		var limit = 10
		if(parseInt(ctx.query.limit)) {
			limit = parseInt(ctx.query.limit)
		} 
		var values = [table_num, ctx.session.user.user_id, limit]
		var actions = {'I': 'lisäys', 'D': 'poisto', 'U': 'muutos'}
		var sql = "SELECT * FROM (SELECT  FROM_UNIXTIME(log_datetime) as date, log.logged_row_id, user.user_name, log.changetype FROM ca_change_log log INNER JOIN ca_users user ON user.user_id = log.user_id WHERE log.logged_table_num IN (?) AND log.user_id = ?  AND log.changetype != 'D' ORDER BY log_id DESC LIMIT ?) as sub GROUP by logged_row_id ORDER BY date DESC;"

		var changes = await this.makeQuery(sql, values);
		for(var change of changes) {
			change.table = getTableName(change.logged_table_num)
			change.action = actions[change.changetype]
			var item = await this.getItem(table, change.logged_row_id, 'FI_fi')
			if(item) {
				change.idno = item.idno
				change.label = item.labels.preferred_label
				change.typename = item.typename
			}
		}
		return changes;

	}

	checkDateRange(key, dateArr) {
		for(var date of dateArr) {
			console.log(date[key])
			if(date[key]) {
				date[key] = this.reverseDateRange(date[key])
			}
		}
		return dateArr;
	}

	//
	reverseDateRange(date) {
		if(!date) return '';
		var dates = date.split('-');
		if(dates.length == 1) {
			return this.reverseDayMonth(dates[0]);
		} else if (dates.length == 2) {
			var d1 = this.reverseDayMonth(dates[0]);
			var d2 = this.reverseDayMonth(dates[1]);
			return d1 + ' - ' + d2;
		}
	}

	reverseDayMonth(date) {
		var parts = date.split('.');
		// 18.04.1971
		if(parts.length == 3) {
			var day = parts[0];
			// switch day and month
			parts[0] = parts[1]
			parts[1] = day;
			return parts.join('.')
		// 4.1971
		} else if(parts.length == 2) {
			return date;
		// 1971
		} else if(parts.length == 1) {
			return date;
		}
	}

	async createItem(table, data, token) {

		if(!data.type_id) throw("Type_id must be set!")

		var object = {
			"intrinsic_fields":{
				"type_id":data.type_id
			},
			"attributes": {},
			"related": {}
		}

		if(data.lot_id) object.intrinsic_fields.lot_id = data.lot_id
		if(data.idno) object.intrinsic_fields.idno = data.idno
		if(data.preferred_labels) object.preferred_labels = data.preferred_labels;
		//if(data.attributes) object.attributes = data.attributes;
		//if(data.related) object.related = data.related;
		if(data.status) object.intrinsic_fields.lot_status_id = data.status;

		if(data.attributes) {
			for(var attr in data.attributes) {
				// separate relations and elements
				if(attr.includes('date')) // TODO: make check that does not depend on attribute name but metadata element type
					object.attributes[attr] = this.checkDateRange(attr, data.attributes[attr]); // must reverse day and month for API call
				else
					object.attributes[attr] = data.attributes[attr];
			}
		}

		if(data.relations) {
			if(data.relations.ca_entities) {
				var relations = [];
				for(var entity of data.relations.ca_entities) {
					relations.push({entity_id: entity.entity_id, type_id: entity.type_id, direction:"ltor"});
				}
				object.related.ca_entities = relations;
			}

			if(data.relations.ca_storage_locations) {
				var relations = [];
				for(var rel of data.relations.ca_storage_locations) {
					relations.push({location_id: rel.location_id, type_id: rel.type_id, direction:"ltor"});
				}
				object.related.ca_storage_locations = relations;
			}

			if(data.relations.ca_collections) {
				var relations = [];
				for(var rel of data.relations.ca_collections) {
					relations.push({collection_id: rel.collection_id, type_id: rel.type_id, direction:"ltor"});
				}
				object.related.ca_collections = relations;
			}
		}

		debug("***** DATA TO BE SEND *******")
		debug(JSON.stringify(object, null, 2))
		debug("***** DATA TO BE SEND ENDS*******")

		var url = this.config.collectiveaccess.url + "/service.php/item/" + table + "?pretty=1&authToken=" + token;
		debug(url)
		var result = await requestp(url, {method: "PUT", json: object})
		// we need to take care of relationship records separately
		debug(result)
		var id = null
		if(table == 'ca_objects') id = result.object_id;
		if(table == 'ca_object_lots') id = result.lot_id;
		if(table == 'ca_entities') id = result.entity_id;
		if(table == 'ca_collections') id = result.collection_id;
		if(table == 'ca_occurrences') id = result.occurrence_id;
		//console.log(object.attributes.ca_entities)

		await this.saveRelationInfo(table, data, id) // relations to entities only!

		return result;

	}


	async createRepresentation(importPath, filename, original_filename, object_id, token) {
		var path = require("path")
		var import_file = path.join(importPath, filename)
		var data = {
			 "intrinsic_fields":{
			   "type_id":"134",
			   "media": import_file,
			   "original_file": original_filename
			 },
			 "preferred_labels":[
			   {
				 "locale":"fi_FI",
				 "name": filename
			   }
			 ],
			  "attributes":{
				"linked_original_file": [
				  {
					"locale":"fi_FI",
					"linked_original_file":original_filename
				  }
				]
			  },
			 "related": {
				 "ca_objects": [{"object_id": object_id}]
			 }
		}

		var url = this.config.collectiveaccess.url + "/service.php/item/ca_object_representations?pretty=1&authToken=" + token;
		debug(url)
		console.log(JSON.stringify(data, null, 2))
		try {
			var result = await requestp(url, {method: "PUT", json: data})
			console.log('**********************************************************************')
			console.log('********           MEDIA IMPORT REQUEST                     *********')
			console.log('**********************************************************************')
			console.log(result)
			if(result.ok) return result;
			else throw(JSON.stringify(data, null, 2))
		} catch(e) {
			console.log(e)
			throw({message: 'Media import failed! ' + e})
		}

	}


	async editItem(table, id, data, token, user_id) {
		if(!id) throw("Item id must be set!")

		// REST API json
		var object = {remove_attributes:[]}

		// add attributes and labels to REST API json
		if(data.attributes && Object.keys(data.attributes).length > 0) {
			object.attributes = {}
			for(var attr in data.attributes) {
				if(attr == 'preferred_labels') {
					object.remove_all_labels = true;
					if(Array.isArray(data.attributes[attr]) && data.attributes[attr].length == 1)
					var label = {locale: 'fi_FI'}
					// entity names have multiple keys (forename, surname, displayname)
					console.log(data.attributes[attr][0])
					for(var key in data.attributes[attr][0]) {
						label[key] = data.attributes[attr][0][key]
					}
					object.preferred_labels = [label];
				} else {
					//if(!object.remove_attributes) object.remove_attributes = []
					object.remove_attributes.push(attr);
					object.attributes[attr] = data.attributes[attr];
				}
			}
		}

		// add relations to REST API json
		if(data.relations && Object.keys(data.relations).length > 0) {
			object.remove_relationships = []
			// if we have relations for table, then we must remove all relations first
			for(var rel_table in data.relations) {
				object.remove_relationships.push(rel_table);
				// if we have data (relations), then we must add them
				if(data.relations[rel_table].length > 0) {
					if(object.related)
						object.related[rel_table] = data.relations[rel_table];
					else {
						object.related = {}
						object.related[rel_table] = data.relations[rel_table];
					}
				}
			}
		}

		debug("***** DATA TO BE SEND *******")
		console.log(JSON.stringify(object, null, 2))
		debug(JSON.stringify(object, null, 2))
		debug("***** DATA TO BE SEND ENDS*******")

		try {
			var url = this.config.collectiveaccess.url + "/service.php/item/" + table + "/id/" + id + "?pretty=1&authToken=" + token;
			debug(url)
			var result = await requestp(url, {method: "PUT", json: object})
			debug(result)
			//if(table == 'ca_objects' || table == 'ca_object_lots') await this.saveRelationInfo(table, data, id)
			if(user_id) await this.logChange(table, id, user_id)
			return result;
		} catch(e) {
			console.log(e)
			throw(e);
		}
	}




	async logChange(table, row_id, user_id) {
		var values = [user_id, TABLES[table], row_id]
		var sql = "insert into ca_change_log (log_datetime, user_id, changetype, logged_table_num, logged_row_id, rolledback) VALUES  (UNIX_TIMESTAMP(),?,'U',?,?,0);"
		try {
			await this.makeQuery(sql, values);
		} catch(e) {
			error('change log write failed')
			debug(e)
		}
	}



	// TODO: make more generic, now only for lot,object -> entities
	async saveRelationInfo(table, data, id) {
		var id_name = 'object_id'
		var rel_table = 'ca_objects_x_entities'
		if(table == 'ca_object_lots') {
			rel_table = 'ca_object_lots_x_entities'
			id_name = 'lot_id'
		}
		debug('*** RELATION INFO for ' + rel_table +' *** ' + table)

		// enitity relationships with relation info (API does not save this data)
		if(data.relations && data.relations.ca_entities) {
			for(var entity of data.relations.ca_entities) {
				if(entity.relation_info) {

					// get element_id for info element, abort if not found
					var element_id = null
					var getElementsByRestriction = "select restr.table_num AS restriction, restr.type_id, restr.element_id, ele.datatype, ele.element_code from ca_metadata_type_restrictions restr INNER JOIN ca_metadata_elements ele ON ele.element_id = restr.element_id where table_num = " + TABLES[rel_table] + ";"
					var element= await this.makeQuery(getElementsByRestriction);
					console.log(element)
					if(element && element[0] && element[0].element_id) {
						element_id = element[0].element_id
					} else {
						error('relation info element not found')
						return
					}

					debug("******** WRITING RELATION INFO ***********")
					// 2. after relationship is saved, we must query for relation_id, so that we can save relationship record
					var sql = "SELECT * FROM " + rel_table + " WHERE entity_id = ? AND " + id_name + " = ? AND type_id = ?;"
					var values = [entity.entity_id, id, entity.type_id];
					debug_sql(sql)
					debug_sql(values)
					var relation = await this.makeQuery(sql, values);
					debug(relation)

					// 3. write relationship info
					// 3.1 first we create an attribute -> attribute_id
					// table_num = 59, element_id = 22, locale_id = 1, row_id = relation.relation_id
					// get info element

					var relation_id = relation[0].relation_id
					var values = [element_id,1,TABLES[rel_table],relation_id]
					debug_sql(sql)
					debug_sql(values)
					var sql_insert = "INSERT INTO ca_attributes (element_id, locale_id, table_num, row_id) VALUES (?, ?, ?, ?)"
					var insert = await this.makeQuery(sql_insert, values);

					// 3.2 get attribute_id
					var sql = "SELECT * FROM ca_attributes WHERE element_id = ? AND locale_id = ? AND table_num = ? AND row_id = ?"
					var attribute = await this.makeQuery(sql, values);
					var attribute_id = attribute[0].attribute_id;

					// 3.3 then we write the attribute value
					var values = [element_id, attribute_id, entity.relation_info];
					var sql_value = "INSERT INTO ca_attribute_values (element_id, attribute_id, item_id, value_longtext1, value_longtext2, value_blob, value_decimal1, value_decimal2,value_integer1, source_info) VALUES (?,?, NULL, ?, NULL, NULL, NULL, NULL, NULL, '')"
					debug_sql(sql_value)
					debug_sql(values)
					var insert_value = await this.makeQuery(sql_value, values);
				}
			}
		}
	}

	async createListItem(list_id, data, token) {

		var url = this.config.collectiveaccess.url + "/service.php/item/ca_list_items/id?pretty=1&authToken=" + token;
		debug(url)
		var result = await requestp(url, {method: "PUT", json: data})
		return result;
	}



	getLabel(key, lang) {
		if(parseInt(key)) {
			var ele = this.getElementById(parseInt(key))
			key = ele.code;
		}
		if(this.elements[key]) {
			var label = this.elements[key].code;
			if(!lang) {
				return label;
			} else {

				for(var label of this.elements[key].labels) {
					if(label.locale == lang) label = label.label;
				}
			}
			return label;
		}
	}



	async getMetadataElements(group_by) {

		var sql = "select  meta.element_id, meta.list_id, meta.element_code, meta.parent_id, meta.datatype, label.name, locale.language, locale.country from ca_metadata_elements meta INNER JOIN ca_metadata_element_labels label ON label.element_id = meta.element_id INNER JOIN ca_locales locale ON locale.locale_id = label.locale_id;"
		var elements_raw = await this.makeQuery(sql);
		var elements = groupBy(elements_raw, 'element_code');
		return elements;
	}

	async getMetadataElement(code, getListValues) {

		var sql = "select  meta.element_id, meta.list_id, meta.element_code, meta.parent_id, meta.datatype, label.name, locale.language, locale.country from ca_metadata_elements meta INNER JOIN ca_metadata_element_labels label ON label.element_id = meta.element_id INNER JOIN ca_locales locale ON locale.locale_id = label.locale_id WHERE meta.element_code = ?;"
		var elements_raw = await this.makeQuery(sql, [code]);
		var elements = groupBy(elements_raw, 'element_code');
		if(elements[code].type == 'container') {
			var sql = "select  meta.element_id, meta.list_id, meta.element_code, meta.parent_id, meta.datatype, label.name, locale.language, locale.country from ca_metadata_elements meta INNER JOIN ca_metadata_element_labels label ON label.element_id = meta.element_id INNER JOIN ca_locales locale ON locale.locale_id = label.locale_id WHERE meta.parent_id = ?;"
			var subs_raw = await this.makeQuery(sql, [elements[code].id]);
			elements[code].elements = groupBy(subs_raw, 'element_code');

			// get list values if desired
			if(getListValues) {
				for(var ele in elements[code].elements) {
					if(elements[code].elements[ele].type == 'list') {
						debug('Getting list values...' + ele)
						var list_items = await this.getList(elements[code].elements[ele].list_id, 'FI_fi');
						elements[code].elements[ele].values = list_items;
					}
				}
			}
		} else if(elements[code].type == 'list' && getListValues) {
			elements[code].values = await this.getList(elements[code].list_id, 'FI_fi');
		}
		return elements;
	}


	async pickValues(data, values, locale, container) {
		for(var key in data) {
			debug('pickvalues key: ' + key + ' container:' + container)
			var ele = this.elements[key];
			if(container && key) {
				ele = this.getElementById(parseInt(key))
				//debug(cont)
			}

			if(ele) {
				values.elements[ele.code] = {element_id:key, type: ele.type, label: this.getLabel(key, locale)};
				var values_arr = []

				// containers
				for(var label of data[key].labels) {
					var value = {}
					value.label = this.getLabel(label.element_code)
					debug('LABEL: ' + value.label + ' element_id: ' + label.element_id)

					if(label.list_id) value.list_id = label.list_id;
					value.type = ELEMENTTYPES[label.datatype]
					value.value = label.value_longtext1;

					// get list item label
					if(value.type === "list") {
						value.value_id = value.value;
						value.value = await this.getListItem(value.list_id, value.value, locale)
					// month and day must be reversed for dates
					} //else if(value.type === "daterange") {
						//value.value = this.reverseDateRange(value.value)
					//}
					value.code = label.element_code;
					value.attribute_id = label.attribute_id;
					values_arr.push(value)
				}

				if(container) {
					var container_values = groupContainerValues(values_arr, 'attribute_id');
					values.elements[ele.code].data = container_values;
				} else {
					values.elements[ele.code].data = values_arr
					debug(values.elements[ele.code].data)
				}
			}
		}
	}


	async getUIScreens(ui_id, model) {

		var sql = "select bundle.settings, bundle.placement_code, bundle.bundle_name, name AS screen_label, screen.screen_id FROM ca_editor_ui_screens screen INNER JOIN ca_editor_ui_screen_labels l ON l.screen_id = screen.screen_id INNER JOIN ca_editor_ui_bundle_placements bundle  ON bundle.screen_id = screen.screen_id  WHERE locale_id = 1 AND ui_id = " + ui_id + " ORDER BY screen.rank, bundle.rank;"

		var items = await this.makeQuery(sql);
		var screens = this.groupScreensBy(items,'screen_label');
		var entity_rels = await this.getRelationInfo('ca_entities')
		var collection_rels = await this.getRelationInfo('ca_collections')
		var location_rels = await this.getRelationInfo('ca_storage_locations')
		var occurrence_rels = await this.getRelationInfo('ca_occurrences')

		// combine screens with model
		 Object.keys(screens).forEach(function(screen){

			var bundles = [];
		    for(var bundle of screens[screen].bundles) {
				// it seems that 1.7.9 bundle naming is changed
				if(bundle.bundle_name && bundle.bundle_name.includes('.')) {
					bundle.bundle_name = bundle.bundle_name.split(".")[1]
				}


				// remove "ca_attribute_" from bundle names
				if(bundle.bundle_name.includes('ca_attribute_')) {
					bundle.bundle_name = bundle.bundle_name.replace('ca_attribute_', '');
				}

				if(bundle.bundle_name == 'status') {
					bundle.settings.datatype ='Statuslist';
					bundle.displayname = "status"
					bundle.list_id = "18";
					//bundle.elements = {elements_in_set: {status:{settings:{}, datatype: 'List'}}}
				}

				for(var element in model.elements) {

					if(element == bundle.bundle_name) {
						bundle.elements = model.elements[element]
					}
				}
				//console.log('BUNDLE.NAME :' + bundle.bundle_name)
				if(bundle.bundle_name in model.elements || bundle.bundle_name == 'preferred_labels' || bundle.bundle_name.includes('ca_')) {
					if(bundle.bundle_name.includes('ca_entities')) {
						bundle.settings.relation_info = entity_rels
					}
					if(bundle.bundle_name.includes('ca_collections')) {
						bundle.settings.relation_info = collection_rels
					}
					if(bundle.bundle_name.includes('ca_storage_locations')) {
						bundle.settings.relation_info = location_rels
					}
					bundles.push(bundle)
				}


			}
			screens[screen].bundles = bundles;

		});

		return screens;
	}


	groupScreensBy(objectArray, property) {
		return objectArray.reduce(function (acc, obj) {
			let key = obj[property]
			if (!acc[key]) {
				acc[key] = {id: obj.screen_id, bundles:[]}
			}
			var settings = PHPUnserialize.unserialize(Base64.decode(obj.settings));
			acc[key].bundles.push({bundle_name:obj.bundle_name, settings:settings})
			return acc
		}, {})
	}

	// currently only objects_x_entities
	async getRelationInfo(table) {

		if(TABLES[table]) {

			// get elements for objects_x_entities
			var getElementsByRestriction = "select restr.table_num AS restriction, restr.type_id, restr.element_id, ele.datatype, ele.element_code from ca_metadata_type_restrictions restr INNER JOIN ca_metadata_elements ele ON ele.element_id = restr.element_id where table_num = " + TABLES[table] + ";"

			var elements = await this.makeQuery(getElementsByRestriction);
			for(var ele of elements) {
				ele.datatype = ELEMENTTYPES[ele.datatype]
				ele.bundle_name = getTableName(ele.restriction) + "." + ele.element_code;
			}

			return elements
		} else {
			return {}
		}
	}

	getPaging(ctx) {
		var limit = "&limit=50", start = ""
		if(parseInt(ctx.query.limit)) limit = "&limit=" + ctx.query.limit;
		if(parseInt(ctx.query.start)) start = "&start=" + ctx.query.start;
		return start + limit;
	}


	async getNextIDNO(lot_id, type) {
		var nextIDNO = {idno: ''}
		var next = 1; // default if we have on objects
		var sql = "SELECT idno, lot_id FROM ca_objects WHERE lot_id = " + lot_id;
		debug_sql(sql)
		var objects = await this.makeQuery(sql);
		if(objects.length > 0) {
			var ids = objects.map(i => {
				var id = i.idno.split(":");
				if(id.length == 2) return parseInt(id[1]);
				else throw("Invalid IDNO");
			})
			ids.sort((a, b) => a - b);
			next = ids[ids.length -1] + 1;
		}
		// add prefix (required in OSC numbering)
		if(type && this.config.numbering_schema.prefix[type]) {
			nextIDNO.idno = this.config.numbering_schema.prefix[type] + lot_id + ":" + next;
		} else {
			nextIDNO.idno = lot_id + ":" + next;
		}
		return nextIDNO;
	}


	async getLocaleValues() {
		var sql = "SELECT * FROM ca_locales;"
		var locales_raw = await this.makeQuery(sql);
		var locales = groupByAttributes(locales_raw, 'locale_id');
		return locales;
	}


	getElementById(id) {
		console.log(typeof id)
		var out = null;
		for(var ele of Object.keys(this.elements)) {
			if(this.elements[ele].id === id) out = this.elements[ele];
		}
		return out;
	}


	async makeQuery(sql, values) {
		var dbconfig = {};
		dbconfig.host = process.env.DB_HOST;
		dbconfig.user = process.env.DB_USER;
		dbconfig.password = process.env.DB_PW;
		dbconfig.database = process.env.DB_NAME;
		const db = makeDb(dbconfig);
		var items = null;
		try {
		  items = await db.query(sql, values);
		} catch ( err ) {
		  // handle the error
		  items = {error: err}
		  console.log(err)
		} finally {
			await db.close();
		}
		return items;
	}


}

module.exports = CA;

// FUNCTIONS



function makeDb( dbconfig ) {
  const connection = mysql.createConnection(dbconfig);  return {
    query( sql, args ) {
      return util.promisify( connection.query )
        .call( connection, sql, args );
    },
    close() {
      return util.promisify( connection.end ).call( connection );
    }
  };
}



function groupContainerValues(objectArray, property) {
	var grouped = groupByAttributes(objectArray, property);
	var out = []
	for(var key in grouped) {
		var obj = {};
		for(var attr of grouped[key]) {
			obj[attr.code] = {value: attr.value, type: attr.type, label: attr.label}
			if(attr.list_id) {
				obj[attr.code].list_id = attr.list_id;
			}
		}
		out.push(obj)
	}
	return out;
}

function groupByElements(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {id: obj.element_id, code: obj.element_code, labels:[]}
		}
		acc[key].labels.push(obj)
		return acc
	}, {})
}

function groupByAttributes(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = []
		}
		acc[key].push(obj)
		return acc
	}, {})
}


function groupListsBy(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {id: obj.list_id, labels:[]}
		}
		acc[key].labels.push({name:obj.name, language: obj.locale, })
		return acc
	}, {})
}

function groupSetsBy(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {id: obj.set_id, labels:[]}
		}
		acc[key].labels.push({name:obj.name, language: obj.locale})
		return acc
	}, {})
}

function groupRelationsBy(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {id: obj.type_code, labels:[]}
		}
		acc[key].labels.push({forward:obj.typename, reverse: obj.typename_reverse, locale: obj.locale})
		return acc
	}, {})
}

function groupRelationItemsBy(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {data: []}
		}
		acc[key].data.push(obj)
		return acc
	}, {})
}

function groupBy(objectArray, property) {
	return objectArray.reduce(function (acc, obj) {
		let key = obj[property]
		if (!acc[key]) {
			acc[key] = {id: obj.element_id, code: obj.element_code, type:ELEMENTTYPES[obj.datatype], list_id: obj.list_id, labels:[]}
		}
		acc[key].labels.push({label:obj.name, locale: obj.language + '_' + obj.country})
		return acc
	}, {})
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


function getTableName(table_num) {
	var table_name = ''
	for(var table in TABLES) {
		if(TABLES[table] === table_num) table_name = table;
	}
	if(!table_name) table_name = table_num;
	return table_name;
}
