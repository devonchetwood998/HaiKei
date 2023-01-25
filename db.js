var sqlite3 = require('sqlite3');
var mkdirp = require('mkdirp');
var crypto = require('crypto');

mkdirp.sync('var/db');

var db = new sqlite3.Database('var/db/users.db');

db.serialize(function() {
  db.run("CREATE TABLE IF NOT EXISTS users ( \
    email TEXT UNIQUE, \
    id INTEGER PRIMARY KEY, \
    username TEXT UNIQUE, \
    email_verified TEXT, \
    hashed_password BLOB, \
    salt BLOB, \
    watchlist TEXT, \
    currentlyWatchingTitle TEXT, \
    currentlyWatchingTime TEXT, \
    currentlyWatchingThumbnail TEXT \
  )");
});

module.exports = db;
