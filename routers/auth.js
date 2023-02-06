const express = require('express');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const limit = require('express-limit').limit;
const { body, validationResult } = require('express-validator');
const sendMail = require('../utils/tokenSender');


/* Configure password authentication strategy.
 *
 * The `LocalStrategy` authenticates users by verifying a username and password.
 * The strategy parses the username and password from the request and calls the
 * `verify` function.
 *
 * The `verify` function queries the database for the user record and verifies
 * the password by hashing the password supplied by the user and comparing it to
 * the hashed password stored in the database.  If the comparison succeeds, the
 * user is authenticated; otherwise, not.
 */
passport.use(new LocalStrategy(function verify(username, password, cb) {
  db.get('SELECT * FROM users WHERE username = ?', [ username ], function(err, row) {
    if (err) { return cb(err); }
    if (!row) { return cb(null, false, { message: 'Incorrect username or password.' }); }
    
    crypto.pbkdf2(password, row.salt, 310000, 32, 'sha256', function(err, hashedPassword) {
      if (err) { return cb(err); }
      if (!crypto.timingSafeEqual(row.hashed_password, hashedPassword)) {
        return cb(null, false, { message: 'Incorrect username or password.' });
      }
      return cb(null, row);
    });
  });
}));

/* Configure session management.
 *
 * When a login session is established, information about the user will be
 * stored in the session.  This information is supplied by the `serializeUser`
 * function, which is yielding the user ID and username.
 *
 * As the user interacts with the app, subsequent requests will be authenticated
 * by verifying the session.  The same user information that was serialized at
 * session establishment will be restored when the session is authenticated by
 * the `deserializeUser` function.
 *
 * Since every request to the app needs the user ID and username, in order to
 * fetch todo records and render the user element in the navigation bar, that
 * information is stored in the session.
 */
passport.serializeUser(function(user, cb) {
  process.nextTick(function() {
    cb(null, { id: user.id, username: user.username, email: user.email });
  });
});

passport.deserializeUser(function(user, cb) {
  process.nextTick(function() {
    return cb(null, user);
  });
});


var router = express.Router();

/* GET /login
 *
 * This route prompts the user to log in.
 *
 * The 'login' view renders an HTML form, into which the user enters their
 * username and password.  When the user submits the form, a request will be
 * sent to the `POST /login/password` route.
 */
router.get('/login', function(req, res, next) {
  res.locals.message = req.flash('error');
  res.render('login');
});

/* POST /login/password
 *
 * This route authenticates the user by verifying a username and password.
 *
 * A username and password are submitted to this route via an HTML form, which
 * was rendered by the `GET /login` route.  The username and password is
 * authenticated using the `local` strategy.  The strategy will parse the
 * username and password from the request and call the `verify` function.
 *
 * Upon successful authentication, a login session will be established.  As the
 * user interacts with the app, by clicking links and submitting forms, the
 * subsequent requests will be authenticated by verifying the session.
 *
 * When authentication fails, the user will be re-prompted to login and shown
 * a message informing them of what went wrong.
 */

// router.post('/login/password', passport.authenticate('local', {
//   successReturnToOrRedirect: '/',
//   failureRedirect: '/login',
//   failureFlash: true
// }));

router.post("/login/password", limit({max: 10, period: 60 * 1000, message: "Request Limit Exceeded!" }), passport.authenticate('local',{ failureRedirect: '/login', failureFlash: true }),
function(req, res) {
        if (req.body.remember) {
          req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // remember cookie expires after 7 days if "remember me" is checked on login
        } else {
          req.session.cookie.expires = false; // Cookie expires at end of session
        }
        const redirect = req.body.returnURL ? req.body.returnURL : '/';
        if (redirect == undefined) {
          res.redirect("/")
        }
        res.redirect(redirect || '/');
});

/* POST /logout
 *
 * This route logs the user out.
 */
router.post('/logout', limit({max: 20, period: 60 * 1000, message: "Request Limit Exceeded!" }), function(req, res, next) {
  req.logout(function (err) {
    if (err) { return next(err); }
  });

    const redirect = req.body.returnURL ? req.body.returnURL : '/';
    res.redirect(redirect || '/');
  });

/* GET /signup
 * This route prompts the user to sign up.
 */
router.get('/signup', function(req, res, next) {
  res.render('signup');
});

/* POST /signup
 * This route creates a new user account.
 */

router.post('/signup', body("email").isEmail(), limit({max: 10, period: 60 * 1000, message: "Request Limit Exceeded!" }), function(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        let loginState;
        let username;
        if (req.user == undefined) {
            loginState = false;
        } else {
            loginState = true;
            username = req.user.username
        }
    let errorList = errors.array()
    let errparam = errorList[0].param
    let errparamFormatting = errparam[0].toUpperCase() + errparam.substring(1)
    if (loginState == true) {
        return res.status(400).render("error.ejs", {errCode: errparamFormatting + " Validation failed!" , loginState: loginState, username: username})
    } else {
        return res.status(400).render("error.ejs", {errCode: errparamFormatting + " Validation failed!", loginState: loginState})
    }
        
    }
    if (req.body.password === req.body.confirm_password) {
        var salt = crypto.randomBytes(16);
        crypto.pbkdf2(req.body.password, salt, 310000, 32, 'sha256', function(err, hashedPassword) {
            if (err) { return next(res.status(400).render('error.ejs', {loginState: 'false', errCode: "Error 500: Try again later!"})); }
            db.run('INSERT INTO users (email, email_verified, username, hashed_password, salt, watchlist) VALUES (?, ?, ?, ?, ?, ?)', [
            req.body.email,
            "false",
            req.body.username,
            hashedPassword,
            salt,
            '{"results":[]}'
            ], function(err) {
            if (err) { return next(res.status(400).render('error.ejs', {loginState: 'false', errCode: "User already exists!"})); }
            var user = {
                email: req.body.email,
                id: this.lastID,
                username: req.body.username
            };
            sendMail(req.body.email, req.body.username);
            req.login(user, function(err) {
                if (err) { return next(err); }
                res.redirect('/');
            });
            });
        });
    } else {
        let loginState;
        let username;
        if (req.user == undefined) {
            loginState = false;
        } else {
            loginState = true;
            username = req.user.username
        }
        res.status(400);
    if (loginState == true) {
        return res.status(400).render("error.ejs", {statusCode: 400, loginState: loginState, errCode: "Account Creation Failure - User Supplied incorrect details"})
    } else {
        return res.status(400).render("error.ejs", {statusCode: 400, loginState: loginState, errCode: "Account Creation Failure - User Supplied incorrect details"})  
    }
}
});

router.get('/verify/:token', (req, res)=>{
  const {token} = req.params;
  let isVerified = false;
  jwt.verify(token, process.env.JWT_SECRET, function(err) {
      if (err) {
          res.send("Email verification failed, possibly the link is invalid or expired");
          console.log(err)
      }
      else {
          res.send("Email verified successfully!");
          isVerified = true;
          db.get('SELECT * FROM users WHERE username = ?', [ req.user.username ], function(err, row) {
            db.run(`UPDATE "main"."users" SET "email_verified"=? WHERE "_rowid_"=?`, [
              isVerified.toString(),
              row.id
            ])
          });
      }
  });
});

module.exports = router;
