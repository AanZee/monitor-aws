var r = null;

exports.init = function (db) {
	r = db;
}

// Create new 'loadBalancer' or update existing one
exports.insertOrUpdate = function(id, loadBalancer, callback) {
	loadBalancer.updatedAt = Date.now();
	loadBalancer.delete = false;

	r.table('awsLoadBalancers')
	.get(id)
	.replace(
		function (row) {
			return r.branch(
				row.eq(null),
				r.expr(loadBalancer).merge({createdAt: Date.now()}),
				row.merge(loadBalancer).merge({})
			)
		},
		{ returnChanges: true }
	)
	.run()
	.then(function(newLoadBalancer){
		if(newLoadBalancer.errors > 0)
			callback(newLoadBalancer.first_error);
		
		else {
			if(newLoadBalancer.unchanged > 0)
				callback(null, loadBalancer);
			
			else {
				newLoadBalancer = newLoadBalancer.changes[0].new_val;
				
				callback(null, newLoadBalancer);
			}
		}
	})
	.error(function(err){
		callback(err);
	});
}

// Before inserting/updating loadBalancers, mark loadBalancers to delete
exports.markToDelete = function() {
	return function(callback) {
		r.table('awsLoadBalancers')
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

// After inserting/updating loadBalancers, delete loadBalancers that doesn't exist anymore
exports.deleteMarked = function() {
	r.table('awsLoadBalancers')
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