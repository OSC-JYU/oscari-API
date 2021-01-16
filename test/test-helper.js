let chai = require('chai');
let chaiHttp = require('chai-http');
let axios = require('axios')

let url = "http://localhost:8080/api";

var cookie = null

let set_name = 'test-set_5'
var set_id = null

chai.use(chaiHttp);

before((done) => {
	(async (done) => {
		try {
			var login = await axios.post(url + '/ca/login', '', {withCredentials: true})
			console.log(login)
		} catch(e) {
			console.log('could not login ' + e) // continue even if collection did not exist
		}

		try {
			var rm = await axios.delete(url + '/ca/sets/' + set_name, '', {withCredentials: true}); 
			console.log(rm)
		} catch(e) {
			console.log('could not delete set ' + e) // continue even if collection did not exist
		}



	})().then(() => {
		done();
	})
});
