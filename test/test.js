

let chai = require('chai');
let chaiHttp = require('chai-http');
let should = chai.should();


let url = "http://localhost:8080/api";

var cookie = null

let set_name = 'test-set_5'
var set_id = null
var person_id = null
var organisation_id = null
var list_item_id = null
var lot_id = null
var object_1_id = null

chai.use(chaiHttp);


describe('Sets', () => {

	describe('/POST login', () => {
		it('should get auth cookies', (done) => {
			chai.request(url)
				.post('/ca/login')
				.send({})
				.end((err, res) => {
					console.log(res.headers)
					cookie = res.header['set-cookie'].join(';').replace(/; path=\/; httponly/g,'')
					console.log(cookie)
					res.should.have.status(200);
					done();
				});
		});
	});

	describe('/POST sets', () => {
		it('should create a set', (done) => {
			let setdata = {
				name: set_name
			};
			chai.request(url)
				.post('/ca/sets')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(200);
					set_id = res.body;
					done();
				});
		});
	});


	describe('/POST sets', () => {
		it('should not create a dublicate set', (done) => {
			let setdata = {
				name: set_name
			};
			chai.request(url)
				.post('/ca/sets')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(409);
					done();
				});
		});
	});

	describe('/DELETE sets', () => {
		it('should delete set', (done) => {
			chai.request(url)
				.delete('/ca/sets/' + set_name)
				.set('Cookie', cookie)
				.end((err, res) => {
					res.should.have.status(204);
					done();
				});
		});
	});

});

describe('Actors', () => {

	describe('/PUT individual', () => {
		it('should create an individual', (done) => {
			let setdata = {
				  "attributes": {
				    "preferred_labels": [],
				    "elinaika": [
				      {
				        "birthdate": "1971",
				        "syntymapaikka": "Juva"
				      }
				    ]
				  },
				  "relations": {},
				  "preferred_labels": [
				    {
				      "forename": "First",
				      "surname": "Person",
				      "locale": "fi_FI"
				    }
				  ],
				  "type_id": 80

			};
			chai.request(url)
				.put('/ca/entities')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(200);
					person_id = res.body.entity_id;
					done();
				});
		});
	});

	describe('/PUT organisation', () => {
		it('should create an organisation', (done) => {
			let setdata = {
				  "attributes": {
				    "preferred_labels": [],
				    "elinaika": [
				      {
				        "birthdate": "1884",
				        "syntymapaikka": "London"
				      }
				    ]
				  },
				  "relations": {},
				  "preferred_labels": [
				    {
				      "forename": "",
				      "surname": "Linley and Briggs",
				      "locale": "fi_FI"
				    }
				  ],
				  "type_id": 81

			};
			chai.request(url)
				.put('/ca/entities')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(200);
					organisation_id = res.body.entity_id;
					done();
				});
		});
	});


	describe('/PUT individual', () => {
		it('should not create individual with invalid birthdate', (done) => {
			let setdata = {
				  "attributes": {
				    "preferred_labels": [],
				    "elinaika": [
				      {
				        "birthdate": "1971 invalid",
				        "syntymapaikka": "Juva"
				      }
				    ]
				  },
				  "relations": {},
				  "preferred_labels": [
				    {
				      "forename": "First",
				      "surname": "Person",
				      "locale": "fi_FI"
				    }
				  ],
				  "type_id": 80

			};
			chai.request(url)
				.put('/ca/entities')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(500);
					done();
				});
		});
	});


});


describe('lists', () => {

	describe('/PUT list item', () => {
		it('should add list item to "object names"', (done) => {
			let setdata = {
				  "intrinsic_fields": {
				    "list_id": "50",
				    "is_enabled": 1,
				    "idno": "bicycle"
				  },
				  "preferred_labels": [
				    {
				      "locale": "fi_FI",
				      "name_singular": "bicycle",
				      "name_plural": "bicycle",
				      "description": ""
				    }
				  ]
				}
			chai.request(url)
				.put('/ca/lists/50/items')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(200);
					list_item_id = res.body;
					done();
				});
		});
	});
});



describe('LOTS', () => {

	describe('/PUT donation LOT', () => {
		it('should create a donation LOT', (done) => {
			let setdata = {
				  "attributes": {
				    "lot_content": [
				      {
				        "lot_content": "All kind of test material"
				      }
				    ]
				  },
				  "relations": {
				    "ca_entities": [
				      {
				        "entity_id": person_id,
						"type_id": "225",
				        "relation_info": "This is a test donater"
				      }
				    ]
				  },
				  "status": "saapunut",
				  "preferred_labels": [
				    {
				      "name": "First donation",
				      "locale": "fi_FI"
				    }
				  ],
				  "type_id": 57
			  };
			chai.request(url)
				.put('/ca/object_lots')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(200);
					lot_id = res.body.lot_id;
					done();
				});
		});
	});
});


describe('objects', () => {

	describe('/PUT object', () => {
		it('should create an object (bicycle)', (done) => {
			let setdata = {
				  "attributes": {
				    "yleisnimi": [
				      {
				        "yleisnimi": "bicycle"
				      }
				    ],
				    "description": [
				      {
				        "description": "An 1885 Whippet safety bicycle\nBy Science museum, CC BY-SA 3.0, https://commons.wikimedia.org/w/index.php?curid=7708717"
				      }
				    ],
				    "pvm_cont": [
				      {
				        "pvm": "1885-1888"
				      }
				    ]
				  },
				  "relations": {
				    "ca_entities": [
				      {

				        "entity_id": organisation_id,
				        "display_label": "Linley and Briggs",
				        "type_id": "182"

				      }
				    ]
				  },
				  "preferred_labels": [
				    {
				      "name": "Whippet",
				      "locale": "fi_FI"
				    }
				  ],
				  "lot_id": lot_id,
				  "type_id": 23,
				  "idno": "1:1"
				}
			chai.request(url)
				.put('/ca/objects')
				.set('Cookie', cookie)
				.send(setdata)
				.end((err, res) => {
					res.should.have.status(200);
					object_1_id = res.body.object_id;
					done();
				});
		});
	});
});
