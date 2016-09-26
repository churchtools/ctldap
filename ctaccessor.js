var querystring = require('querystring');
var http=Object();
http["http"]= require('http');
http["https"]= require('https');

var ct_options={};

exports.jsendReadData = jsendReadData;
exports.setOptions = setOptions;

function setOptions(options) {
  ct_options=options;
}

function jsendReadData(q, data, success) {
  var dataString = querystring.stringify(data);
  var headers = {};

  headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': dataString.length
  };

  var options = {
    host: ct_options.ct_host,
    port: ct_options.ct_port,
    path: ct_options.ct_path+"?q="+q,
    method: "post",
    headers: headers
  };

  var req = http[ct_options.ct_protocol].request(options, function(res) {
    res.setEncoding('utf-8');

    var responseString = '';

    res.on('data', function(data) {
      responseString += data;
    });

    res.on('end', function() {
      try {
        var responseObject = JSON.parse(responseString);
        success(responseObject.status=="success", responseObject.data);
      }
      catch(e) {
        console.log(responseString);
        console.log(e);
        console.error("Error by parsing CT-Answer");
      }
    });
  });

  req.write(dataString);
  req.end();
  req.on('error', function(e) {
    console.error("Connection to CT failed:"+e);
    console.log(options);
  });
}