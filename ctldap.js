// ChurchTools 2.0 LDAP-Server
// This tool requires node.js-Server
// 2014 Jens Martin Rauen
//
// User has to be a valid email-address

var ldap = require('ldapjs');
var mysql = require('mysql');
var fs = require('fs');
var ini = require('ini');
var ct = require('./ctaccessor');

var server = ldap.createServer();
var ldap_config = ini.parse(fs.readFileSync('./ctldap.config', 'utf-8'));
ct.setOptions({"ct_host":ldap_config.ct_host, "ct_port":ldap_config.ct_port,
        "ct_protocol":ldap_config.ct_protocol, "ct_path":ldap_config.ct_path});
if (ldap_config.debug) console.log("Debug mode is on!");

if (ldap_config.db_port==null) ldap_config.db_port=3306;
var db_config = {
  host     : ldap_config.db_server,
  port     : ldap_config.db_port,
  user     : ldap_config.db_user,
  database : ldap_config.db_name,
  password : ldap_config.db_password
};

// MySQL Connect
function handleSQLConnection() {
  connection = mysql.createConnection(db_config); // Recreate the connection, since
                                                  // the old one cannot be reused.

  connection.connect(function(err) {              // The server is either down
    if(err) {                                     // or restarting (takes a while sometimes).
      console.log('Error when connecting to DB:', err);
      setTimeout(handleSQLConnection, 2000); // We introduce a delay before attempting to reconnect
    }
    else {
      console.log("Connected to DB "+db_config.user+"@"+db_config.host+":"
          +db_config.port+'/'+db_config.database+".");
    }

  });

  connection.on('error', function(err) {
    console.log('DB error', err);
    if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
      handleSQLConnection();                         // lost due to either server restart, or a
    } else {                                      // connnection idle timeout (the wait_timeout
      throw err;                                  // server variable configures this)
    }
  });
}

handleSQLConnection();

// Bind for main ldap user
server.bind('cn='+ldap_config.ldap_user, function(req, res, next) {
  if (ldap_config.debug) console.log('bind DN: ' + req.dn.toString());
  if (req.dn.toString() !== 'cn='+ldap_config.ldap_user || req.credentials !== ldap_config.ldap_password) {
    console.log("invalid cred!");
    return next(new ldap.InvalidCredentialsError());
  }

  res.end();
  return next();
});

// Login bind for user
server.bind('ou=users, o='+ldap_config.ldap_hostname, function(req, res, next) {
  console.log('User bind DN: ' + req.dn.toString());

  connection.query("SELECT id, email, cmsuserid from cdb_person where cmsuserid='"+req.dn.rdns[0].cn+"'",
  function(err, rows, fields) {

    if (rows[0]==null) {
      if (ldap_config.debug) console.log("User not found:"+req.dn.rdns[0].cn);
      return next(new ldap.InvalidCredentialsError());
    }
    ct.jsendReadData("login", {email:rows[0].email, password:req.credentials, directtool:"true"}, function(ok, data) {
      if (!ok) {
        console.log("Password invalid or email wrong: "+req.dn.rdns[0].cn+" - "+data);
        return next(new ldap.InvalidCredentialsError());
      }
      res.end();
      return next();
    });
  });
});

String.prototype.encode = function() {
  var cn=this.toLowerCase();
  cn = cn.replace(/ö/g,"oe");
  cn = cn.replace(/ä/g,"ae");
  cn = cn.replace(/ü/g,"ue");
  cn = cn.replace(/ß/g,"ss");
  cn = cn.replace(/[^a-z0-9]/g,"");
  return cn;
};


var cache_user=new Object();

// Load user from ChurchTools over MySQL
function loadCTUser(req, res, next) {

  if (1==2 && cache_user[req.connection.ldap.bindDN]!=null) {
    if (ldap_config.debug) console.log("Load user from Cache for "+req.connection.ldap.bindDN);
    req.users=cache_user[req.connection.ldap.bindDN].data;
    return next();
  }
  console.log("Load User online for bind: "+req.connection.ldap.bindDN);

  if (req.connection.ldap.bindDN!='cn='+ldap_config.ldap_user) {
    console.log("UUUUPS!!");
  }
//  else
  {

    connection.query("SELECT id, cmsuserid, vorname, name, email, telefonhandy, telefonprivat, plz, strasse, ort from cdb_person where cmsuserid!=''",
    function(err, rows, fields) {
      if (err) throw err;

      req.users = {};
      Object.keys(rows).forEach(function(k,p) {
        var cn=rows[k].cmsuserid.encode();
        req.users[cn] = {
          dn: 'cn='+cn+",ou=users,o="+ldap_config.ldap_hostname,
          attributes: {
            cn: cn,
            displayname:rows[k].vorname+" "+rows[k].name,
            id: rows[k].id,
            uid:cn+"UID",
            nsuniqueid: rows[k].id,
            givenname: rows[k].vorname,
            street:rows[k].street,
            telephoneMobile: rows[k].telefonhandy,
            telephoneHome: rows[k].telefonprivat,
            postalCode:rows[k].plz,
            l:rows[k].ort,
            sn: rows[k].name,
            email: rows[k].email,
            mail: rows[k].email,
            objectclass: 'CTPerson'
          }
        };
        connection.query("SELECT g.bezeichnung FROM cdb_gemeindeperson_gruppe gpg, cdb_gruppe g, cdb_gemeindeperson gp, cdb_grouptype_memberstatus gtms"
                            + " WHERE gpg.gruppe_id = g.id AND g.groupstatus_id=1 AND gpg.gemeindeperson_id = gp.id AND gpg.gruppenteilnehmerstatus_id = gtms.id"
                            + " AND gtms.deleted_yn = 0 AND gtms.request_yn = 0 AND gp.person_id =?", rows[k].id, function(err2, rows2, fields2) {
        if (err2) throw err2;
        var arr = new Array();
        Object.keys(rows2).forEach(function(i,g) {
          arr.push("cn=" + rows2[i].bezeichnung.encode() + ",ou=groups,o=churchtools");
        }); 
        if (arr.length > 0) req.users[cn].attributes.uniquemember = arr;
        }); 
     });





      console.log("User loaded.");
      //cache_user[req.connection.ldap.bindDN] = new Object();
     // cache_user[req.connection.ldap.bindDN].data=req.users;
     // cache_user[req.connection.ldap.bindDN].timer=setTimeout(function() {
      //  cache_user[req.connection.ldap.bindDN]=null;
       // console.log("Delete user cache");
      //}
      //,10000);
      return next();
    });
  }
}


function getMemberOfGroups(next) {
  var res=new Array();
  connection.query("SELECT gpg.gruppe_id, p.cmsuserid FROM " +
  		"cdb_gemeindeperson_gruppe gpg, cdb_gemeindeperson gp, cdb_person p, cdb_grouptype_memberstatus gtms "
                    +" WHERE gp.id=gpg.gemeindeperson_id and gp.person_id=p.id"
                          +" and cmsuserid!='' and gtms.id = gpg.gruppenteilnehmerstatus_id " +
                          		"AND gtms.request_yn = 0 AND gtms.deleted_yn = 0",
  function(err, rows, fields) {
    if (err) throw err;
    Object.keys(rows).forEach(function(k, g) {
      if (res[rows[k].gruppe_id]==null) res[rows[k].gruppe_id]=new Array();
      res[rows[k].gruppe_id].push("cn="+rows[k].cmsuserid.encode()+",ou=users,o="+ldap_config.ldap_hostname);
    });
    next(res);
  });
}

var cache_groups = new Object();

// Load Groups over MySQL
function loadCTGroups(req, res, next) {

  if (1==2 && cache_groups[req.connection.ldap.bindDN]!=null) {
    if (ldap_config.debug) console.log("Load Groups from cache");
    req.groups=cache_groups[req.connection.ldap.bindDN].data;
    return next();
  }

  connection.query("SELECT g.id, g.bezeichnung, gt.bezeichnung gruppentyp "+
         "from cdb_gruppe g, cdb_gruppentyp gt "+
         "where g.groupstatus_id=1 and versteckt_yn=0 and g.gruppentyp_id=gt.id ",
  function(err, rows, fields) {
    if (err) throw err;

    getMemberOfGroups(function(members) {

      req.groups = {};
      Object.keys(rows).forEach(function(k, g) {
        var cn=rows[k].bezeichnung.encode();
        var gruppentyp=rows[k].gruppentyp.encode();

        req.groups[cn] = {
          dn: 'cn='+cn+ ",ou=groups,o="+ldap_config.ldap_hostname,
          attributes: {
            cn: cn,
            displayname: rows[k].bezeichnung,
            nsuniqueid: rows[k].id,
            objectclass: 'CTGruppe'+gruppentyp,
            uniquemember: members[rows[k].id] // Array of dns
          }
        };
      });
      cache_groups[req.connection.ldap.bindDN] = new Object();
      cache_groups[req.connection.ldap.bindDN].data=req.groups;
      cache_groups[req.connection.ldap.bindDN].timer=setTimeout(function() {
        cache_groups[req.connection.ldap.bindDN]=null;
        console.log("Delete group cache");
      }
      ,10000);
      return next();
    });
  });
}

// Pre functions will be calles before executing search
var pre =[loadCTUser, loadCTGroups];
// Search implementation for user and group search
server.search('o='+ldap_config.ldap_hostname, pre, function(req, res, next) {
  if (ldap_config.debug) console.log('SEARCH base object: ' + req.dn.toString()+" scope: "+ req.scope);
  if (ldap_config.debug) console.log('Filter: '+req.filter.toString());
  Object.keys(req.users).forEach(function(k) {
    // When scope=base have to check the complete dn
    if ((req.scope!="base" || req.dn.toString()==req.users[k].dn)
          && (req.filter.matches(req.users[k].attributes))) {
      if (ldap_config.debug) console.log("MatchUser: "+k);
      res.send(req.users[k]);
    }
  });
  Object.keys(req.groups).forEach(function(k) {
    if ((req.scope!="base" || req.dn.toString()==req.groups[k].dn)
       &&  (req.filter.matches(req.groups[k].attributes))) {
      if (ldap_config.debug) console.log("MatchGroup: "+k);
      res.send(req.groups[k]);
    }
  });
  res.end();
  return next();
});

// Start ldap server
server.listen(parseInt(ldap_config.ldap_port), function() {
  console.log('CT-LDAP-Server started up at: %s', server.url);
});

//connection.end();

