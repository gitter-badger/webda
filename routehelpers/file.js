"use strict";
const Executor = require("../services/executor.js");

/**
 * Execute a custom JS file, it is almost like a custom Service except that this will not be a singleton
 * And it will be instantiate every call
 *
 * Configuration
 * '/url': {
 *    'type': 'file',
 *    'file': './customroute.js'	
 * }
 *
 */
class FileRouteHelper extends Executor {

	/**
	 * @ignore
	 */
	execute(ctx) {
		if (typeof(ctx._route.file) === "string") {
			var include = ctx._route.file;
			if (include.startsWith("./")) {
				include = process.cwd() + '/' + include;
			}
			return require(include)(ctx);
		} else {
			return ctx._route.file(ctx);
		}
	}
}

module.exports = FileRouteHelper;