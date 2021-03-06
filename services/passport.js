"use strict";

const Executor = require('./executor.js');
var passport = require('passport');
const crypto = require("crypto");
const _extend = require("util")._extend;
const Ident = require('../models/ident');

var Strategies = {
	"facebook": {strategy: require('passport-facebook').Strategy, promise: false},
	"google": {strategy: require('passport-google-oauth').OAuth2Strategy, promise: false},
	"amazon": {strategy: require('passport-amazon').Strategy, promise: false},
	"github": {strategy: require('passport-github2').Strategy, promise: false},
	"twitter": {strategy: require('passport-twitter').Strategy, promise: true}
}

/**
 * This class is known as the Authentication module
 * It handles OAuth for several providers for now (Facebook, Google, Amazon, GitHub and Twitter)
 * It also handles email authentication with prevalidation or postvalidation of the email
 *
 * It requires two Store to work one 'idents' and one 'users'
 *
 * The parameters are 
 *
 *	 providerName: {
 *     clientID: '...',
 *     clientSecret: '...',
 *     scope: ''
 *   },
 *   email: {
 *	    postValidation: true|false   // If postValidation=true, account created without email verification
 *   }
 *   expose: 'url' // By default /auth
 *
 */
class PassportExecutor extends Executor {
	/** @ignore */
	constructor(webda, name, params) {
		super(webda, name, params);
		this._type = "PassportExecutor";
	}

	/**
	 * @ignore
	 * Setup the default routes
	 */
	init(config) {
		var url = this._params.expose;
		if (url === undefined) {
			url = '/auth';
		} else {
			url = this._params.expose;
		}
		let identStoreName = this._params.identStore;
		let userStoreName = this._params.userStore;
		if (identStoreName === undefined) {
			identStoreName = "idents";
		}
		if (userStoreName === undefined) {
			userStoreName = "users";
		}
		this._identsStore = this.getService(identStoreName);
		this._usersStore = this.getService(userStoreName);
		if (this._identsStore === undefined || this._usersStore === undefined) {
			this._initException = "Unresolved dependency on idents and users services";
		}
		// List authentication configured
		config[url] = {"method": ["GET", "DELETE"], "executor": this._name, "_method": this.listAuthentications};
		// Get the current user
		config[url + "/me"] = {"method": ["GET"], "executor": this._name, "_method": this.getMe};
		// Add static for email for now, if set before it should have priority
		config[url + "/email"] = {"method": ["POST"], "executor": this._name, "params": {"provider": "email"}, "_method": this.handleEmail};
		config[url + "/email/callback{?email,token}"] = {"method": ["GET"], "executor": this._name, "params": {"provider": "email"}, "aws": {"defaultCode": 302, "headersMap": ['Location', 'Set-Cookie']}, "_method": this.handleEmailCallback};
		// Handle the lost password here
		url += '/{provider}';
		config[url] = {"method": ["GET"], "executor": this._name, "aws": {"defaultCode": 302, "headersMap": ['Location', 'Set-Cookie']}, "_method": this.authenticate};
		config[url + "/callback{?code,oauth_token,oauth_verifier,*otherQuery}"] = {"method": "GET", "executor": this._name, "aws": {"defaultCode": 302, "headersMap": ['Location', 'Set-Cookie']}, "_method": this.callback};
	}


	callback(ctx) {
		var providerConfig = this._params.providers[ctx._params.provider];
		if (!providerConfig) {
			throw 404;
		}
		return new Promise( (resolve, reject) => {
			var done = function(result) { resolve(); }; 
			this.setupOAuth(ctx, providerConfig);
			passport.authenticate(ctx._params.provider, { successRedirect: this._params.successRedirect, failureRedirect: this._params.failureRedirect}, done)(ctx, ctx, done);
		});
	};

	getMe(ctx) {
		if (ctx.session.getUserId() === undefined) {
			throw 404;
			return;
		}
		return this._usersStore.get(ctx.session.getUserId()).then( (user) => {
			if (user === undefined) {
				throw 404;
			}
			ctx.write(user);
			return;
		});
	}
	listAuthentications(ctx) {
		if (ctx._route._http.method === "DELETE") {
			this.logout(ctx);
			ctx.write("GoodBye");
			return;
		}
		ctx.write(Object.keys(this._params.providers));
	}

	getCallbackUrl(ctx, provider) {
		if (this._params.providers[ctx._params.provider].callbackURL) {
			return this._params.providers[ctx._params.provider].callbackURL;
		}
		// Issue with specified port for now
		var url = ctx._route._http.protocol + "://" + ctx._route._http.host + ctx._route._http.url;
		if (url.endsWith("/callback")) {
			return url;
		}
		return url + "/callback";
	};

	handleOAuthReturn(ctx, profile, ident, done) {
		var identStore = this._identsStore;
		var userStore = this._usersStore;
		var userPromise;
		return identStore.get(ident.uuid).then( (result) => {
			// Login with OAUTH
			if (result) {
				ctx.write("login");
				this.login(ctx, result.user, result);
				// Need to improve DynamoDB testing about invalid value 
				return identStore.update({'lastUsed': new Date(), 'profile': profile}, result.uuid).then( () => {
					ctx.write("redirect");
					ctx.writeHead(302, {'Location': this._params.successRedirect + '?validation=' + ctx._params.provider});
					ctx.end();
					done(result);
				});
			}
			// Registration with OAuth
			let promise;
			if (ctx.session.getUserId()) {
				promise = Promise.resolve({'uuid':ctx.session.getUserId()});
			} else {
				promise = userStore.save(this.registerUser(ctx, profile._json));
			}
			return promise.then( (user) => {
				ctx.write("register new ident");
				ident.user = user.uuid;
				ident.lastUsed = new Date();
				ident.profile = profile;
				return identStore.save(ident).then( () => {
					ctx.write("redirect");
					this.login(ctx, user, ident);
					ctx.writeHead(302, {'Location': this._params.successRedirect + '?validation=' + ctx._params.provider});
					ctx.end();
					done(ident)
				});
			});
		}).catch( (err) => {
			done(err);
		});
	}

	setupOAuth(ctx, config) {
		config.callbackURL = this.getCallbackUrl(ctx);
		passport.use(new Strategies[ctx._params.provider].strategy(config,(accessToken, refreshToken, profile, done) => {
				this.handleOAuthReturn(ctx, profile._json, new Ident(ctx._params.provider, profile.id, accessToken, refreshToken), done);
			}
		));
	}

	registerUser(ctx, datas, user) {
		if (!user) {
			user = {};
		}
		this.emit("Register", {"user": user, "datas": datas, "ctx": ctx});
		return user;
	}

	handleEmailCallback(ctx) {
		// Validate an email for an ident based on an url
		var identStore = this.getService("idents");
		if (identStore === undefined) {
			console.log("Email auth needs an ident store");
			throw 500;
		}
		if (ctx._params.token) {
			let validation = ctx._params.token;
			if (validation !== this.generateEmailValidationToken(ctx._params.email)) {
				ctx.writeHead(302, {'Location': this._params.failureRedirect});
				return Promise.resolve();
			}
			var uuid = ctx._params.email + "_email";
			return identStore.get(uuid).then((ident) => {
				if (ident === undefined) {
					throw 404;
				}
				return identStore.update({validation: new Date()}, ident.uuid);	
			}).then ( () => {
				ctx.writeHead(302, {'Location': this._params.successRedirect + '?validation=' + ctx._params.provider});
				return Promise.resolve();
			});
		}
		throw 404;
	}

	handlePhoneCallback(req, res) {

	}

	sendValidationEmail(ctx, email) {
		var config = this._params.providers.email;
		if (!config.validationEmailSubject) {
			config.subject = "Webda Framework registration email";
		}
		let text = config.validationEmailText;
		if (!text) {
			text = "Please validate your email by clicking the link below\n{url}";
		}
		let replacements = _extend({}, config);
		replacements.url = ctx._route._http.root + "/auth/email/callback?email=" + email + "&token=" + this.generateEmailValidationToken(email);
		// TODO Add a template engine
		for (let i in replacements) {
			if (typeof(replacements[i]) !== "string") continue;
			text = text.replace("{"+i+"}", replacements[i]);
		}
		let mailOptions = {
		    to: email, // list of receivers
		    subject: config.subject, // Subject line
		    text: text
        };
		this.getMailMan().send(mailOptions);
	}

	hashPassword(pass) {
		var hash = crypto.createHash('sha256');
		return hash.update(pass).digest('hex');
	}

	logout(ctx) {
		this.emit("Logout", {ctx: ctx});
		ctx.session.destroy();
	}

	login(ctx, user, ident) {
		var event = {};
		event.userId = user;
		if (typeof(user) == "object") {
			event.userId = user.uuid;
			event.user = user;
		}
		event.identId = ident;
		if (typeof(ident) == "object") {
			event.identId = ident.uuid;
			event.ident = ident;
		}
		event.ctx = ctx;
		ctx.session.login(event.userId, event.identId);
		this.emit("Login", event);
	}

	getMailMan() {
		return this.getService(this._params.providers.email.mailer?this._params.providers.email.mailer:"Mailer");
	}

	handleEmail(ctx) {
		var identStore = this._identsStore;
		if (identStore === undefined) {
			console.log("Email auth needs an ident store");
			throw 500;
		}
		if (ctx.body.password === undefined || ctx.body.login === undefined) {
			throw 400;
		}
		var mailConfig = this._params.providers.email;
		var mailerService = this.getMailMan();
		if (mailerService === undefined) {
			// Bad configuration ( might want to use other than 500 )
			//throw 500;
		}
		var userStore = this._usersStore;
		var updates = {};
		var uuid = ctx.body.login + "_email";
		return identStore.get(uuid).then( (ident) => {
			if (ident != undefined && ident.user != undefined) {
				// Register on an known user
				if (ctx._params.register) {
					throw 409;
				}
				return userStore.get(ident.user).then ( (user) => {
					// Check password
					if (user._password === this.hashPassword(ctx.body.password)) {
						if (ident.failedLogin > 0) {
							ident.failedLogin = 0;
						}
						updates.lastUsed = new Date();
						updates.failedLogin = 0;

						return identStore.update(updates, ident.uuid).then ( () => {
							this.login(ctx, ident.user, ident);
							ctx.write(user);
							return Promise.resolve();
						});
						
					} else {
						ctx.writeHead(403);
						if (ident.failedLogin === undefined) {
							ident.failedLogin = 0;
						}
						updates.failedLogin = ident.failedLogin++;
						updates.lastFailedLogin = new Date();
						// Swalow exeception issue to double check !
						return identStore.update(updates, ident.uuid);
					}
				});
			} else {
				var user = ctx.body.user;
				var email = ctx.body.login;
				var registeredUser;
				var validation;
				// Read the form
				if (ctx.body.register || ctx._params.register) {
					var validation = undefined;
					// Need to check email before creation
					if (!mailConfig.postValidation || mailConfig.postValidation === undefined) {
						if (ctx.body.token == this.generateEmailValidationToken(email)) {
							validation = new Date();
						} else {
							ctx.write({});
							// token is undefined send an email
							return this.sendValidationEmail(ctx, email);
						}
					}
					if (user === undefined) {
						user = {};
					}
					// Store with a _
					ctx.body._password = this.hashPassword(ctx.body.password);
					delete ctx.body.password;
					delete ctx.body.register;
					return userStore.save(this.registerUser(ctx, ctx.body, ctx.body)).then ( (user) => {
						var newIdent = {'uuid': uuid, 'type': 'email', 'email': email, 'user': user.uuid};
						if (validation) {
							newIdent.validation = validation;
						}
						return identStore.save(newIdent).then ( (ident) => {
							this.login(ctx, user, ident);
							ctx.write(user);
							if (!validation && !mailConfig.skipEmailValidation) {
								return this.sendValidationEmail(ctx, email);
							}
							return Promise.resolve();
						});
					});
				}
				throw 404;
			}
			ctx.end();
		});
	}

	generateEmailValidationToken(email) {
		return this.hashPassword(email + "_" + this._webda.getSecret());
	}

	handlePhone() {
		ctx.writeHead(204);
	}

	authenticate(ctx) {
		// Handle Logout 
		if (ctx._params.provider == "logout") {
			this.logout(ctx);
			if (this._params.website) {
				ctx.writeHead(302, {'Location': this._params.website});
			} else {
				throw 204;
			}
			return;
		}
		var providerConfig = this._params.providers[ctx._params.provider];
		if (providerConfig) {
			if (!Strategies[ctx._params.provider].promise) {
				this.setupOAuth(ctx, providerConfig);
				return passport.authenticate(ctx._params.provider, {'scope': providerConfig.scope})(ctx, ctx);
			}
			var self = this;
			return new Promise( (resolve, reject) => {
				ctx._end = ctx.end;
				ctx.end = function(obj) { ctx.end=ctx._end; resolve(obj); };
				this.setupOAuth(ctx, providerConfig);
				passport.authenticate(ctx._params.provider, {'scope': providerConfig.scope}, this._oauth1)(ctx, ctx, ctx._oauth1);
			});
		}
		throw 404;
	}

	static getModda() {
		return {
			"uuid": "Webda/Authentication",
			"label": "Authentication",
			"description": "Implements user registration and login using either email or OAuth, it handles for now Facebook, Google, Amazon, GitHub, Twitter\nIt needs a Idents and a Users Store to work",
			"webcomponents": [],
			"logo": "images/placeholders/passport.png",
			"documentation": "https://raw.githubusercontent.com/loopingz/webda/master/readmes/Authentication.md",
			"configuration": {
				"default": {
					"successRedirect": "YOUR WEBSITE LOGGED PAGE",
					"failureRedirect": "YOUR WEBSITE FAILURE PAGE",
					"providers": {
						"facebook": {
							"clientID": "",
							"clientSecret": "",
							"scope": ["email", "public_profile"]
						},
						"email": {
							"postValidation": false
						}
					}
				},
				"schema": {
					type: "object",
					properties: {
						"expose": {
							type: "boolean"
						},
						"successRedirect": {
							type: "string"
						},
						"failureRedirect": {
							type: "string"
						},
						"providers": {
							type: "object"
						}
					},
					required: ["successRedirect", "failureRedirect", "providers"]
				}
			}
		}
	}
}

module.exports = PassportExecutor
