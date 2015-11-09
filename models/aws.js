var r = null;

exports.init = function (db) {
	r = db;
}

// Create new moduleData or update existing one
exports.insertOrUpdateInstance = function(id, instance, callback) {
	r.table('awsInstances')
	.get(id)
	.replace(
		function (row) {
			return r.branch(
				row.eq(null),
				r.expr(instance).merge({createdAt: Date.now(), updatedAt: Date.now()}),
				row.merge(instance).merge({updatedAt: Date.now()})
			)
		},
		{ returnChanges: true }
	)
	.run()
	.then(function(newInstance){
		if(newInstance.errors > 0)
			callback(newInstance.first_error);
		
		else {
			if(newInstance.unchanged > 0)
				callback(null, instance);
			
			else {
				newInstance = newInstance.changes[0].new_val;
				
				callback(null, newInstance);
			}
		}
	})
	.error(function(err){
		callback(err);
	});
}