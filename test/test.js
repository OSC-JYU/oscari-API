

let chai = require('chai');
let chaiHttp = require('chai-http');
let should = chai.should();


let url = "http://localhost:8080/api";

var cookie = null

let set_name = 'test-set_5'
var set_id = null

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


