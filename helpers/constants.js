exports.constants = {
	admin: {
		name: "admin",
		email: "admin@admin.com"
	},
	confirmEmails: {
		from : "no-reply@test-app.com"
	}
};

exports.hexes = {
	ZERO_HASH: '0x0000000000000000000000000000000000000000000000000000000000000000',
}

exports.getlogs = {
	CONCURRENCY: 10,
	CHUNK_SIZE_HARD_CAP: 4000,
	TARGET_LOGS_PER_CHUNK: 500,
}
