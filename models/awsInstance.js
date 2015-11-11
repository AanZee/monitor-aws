var r = null;

exports.init = function (db) {
	r = db;
}

// Create new 'instance' or update existing one
exports.insertOrUpdate = function(id, instance, callback) {
	instance.updatedAt = Date.now();
	instance.delete = false;

	r.table('awsInstances')
	.get(id)
	.replace(
		function (row) {
			return r.branch(
				row.eq(null),
				r.expr(instance).merge({createdAt: Date.now()}),
				row.merge(instance).merge({})
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

// Before inserting/updating instances, mark instances to delete
exports.markToDelete = function() {
	return function(callback) {
		r.table('awsInstances')
		.update({delete: true})
		.run()
		.then(function(marked){
			callback(null);
		})
		.error(function(err){
			callback(err);
		});
	}
}

// After inserting/updating instances, delete instances that doesn't exist anymore
exports.deleteMarked = function() {
	r.table('awsInstances')
	.getAll(true, {index: 'delete'})
	.delete()
	.run()
	.then(function(deleted){
		// Deleted
	})
	.error(function(err){
		// Error
	});
}