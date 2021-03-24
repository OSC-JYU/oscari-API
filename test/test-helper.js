const chaiExec = require("@jsdevtools/chai-exec");
let chai = require('chai');
let chaiHttp = require('chai-http');
let axios = require('axios')

let url = "http://localhost:8080/api";

var cookie = null

let set_name = 'test-set_5'
var set_id = null

//chai.use(chaiHttp);
//chai.use(chaiExec);


before(function(){
   console.log('BEFORE*******************')
   chaiExec(`sh koe.sh`);
});
