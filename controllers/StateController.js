const _ = require('lodash');
const apiResponse = require("../helpers/apiResponse");
const LogsStateModel = require('../models/LogsStateModel')
const ConfigModel = require('../models/ConfigModel')
var mongoose = require("mongoose");
mongoose.set("useFindAndModify", false);

exports.query = [
	async function (req, res) {
		try {
			const { key } = req.params
			if (!key) {
				var keys = []
				const path = require("path")
				const normalizedPath = path.join(__dirname, "../consumers");
				require("fs").readdirSync(normalizedPath).forEach(file => {
					if (path.extname(file) == '.js') {
						const key = file.split('.').slice(0, -1).join('.')
						keys.push(key)
					}
				})
			} else {
				var keys = key.split(',')
			}

			const states = await ConfigModel.find({ key: { $in: keys } }).lean()
			const ret = states
				.filter(s => !!s)
				.reduce((res, s, i) => ({...res, [s.key]: s.value}), {})

			return apiResponse.successResponseWithData(res, "Operation success", ret);
		} catch (err) {
			console.error(err)
			return apiResponse.ErrorResponse(res, err);
		}
	}
]
