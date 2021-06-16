var mongoose = require("mongoose");

var Schema = mongoose.Schema;

// TODO: rename to ChainState
var LogsStateSchema = new Schema({
    key:    { type: String,                 required: true },
    value:  { type: Schema.Types.Mixed,     required: true },
    range:  { type: Schema.Types.Mixed,     required: false },
}, { timestamps: true });

module.exports = mongoose.model("LogsState", LogsStateSchema);