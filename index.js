exports.isMonitoringModule = true;
exports.hasCron = true;
exports.snapshotData = true;

var async = require('async');
var responseMessaging = require('monitor-response');
var AWS = require('aws-sdk');
AWS.config.apiVersions = {elb: '2012-06-01'};

var AwsInstance = null;
var AwsLoadBalancer = null;

var elb = null;
var ec2 = null;

var instances = [];
var loadBalancers = [];

/**
 * Module config:
 * 
 * 	"monitor-aws": {
 *		"cronTime": "",
 * 		"credentials": [{
 *				"accessKeyId": "",
 *				"secretAccessKey": "",
 *				"region": []
 *			}
 *		]
 * 	}
 */

// Tables this module need to function
exports.tables = [
	{
		name: 'awsInstances',
		index: [
			'monitorClientId',
			'delete'
		]
	},
	{
		name: 'awsLoadBalancers',
		index: [
			'delete'
		]
	}
];

exports.init = function (db) {
	AwsInstance = require('./models/awsInstance');
	AwsInstance.init(db);

	AwsLoadBalancer = require('./models/awsLoadBalancer');
	AwsLoadBalancer.init(db);
}

exports.executeCron = function (cb) {
	awsCredentials = this.config.credentials;

	// Reset
	instances = [];
	loadBalancers = [];

	var actions = [];

	// mark instances/loadBalancers toDelete (afterwards deleting old instances)
	actions.push(AwsInstance.markToDelete());
	actions.push(AwsLoadBalancer.markToDelete());

	// Loop through all awsCredentials
	for (var i in awsCredentials) {
		var AWSConfig = JSON.parse(JSON.stringify(awsCredentials[i])); // duplicate credentials
		var regions = AWSConfig.region;

		// Loop through all regions within awsCredentials
		for (var j in regions) {
			AWSConfig.region = regions[j];
			AWS.config.update(AWSConfig);
			
			// Get all instances for this region
			ec2 = new AWS.EC2();
			actions.push(describeInstances(ec2));

			// Get all loadBalancers for this region
			elb = new AWS.ELB();
			actions.push(describeLoadBalancersWithInstanceHealth(elb));
		}
	}

	// insert or update instances/loadBalancers
	actions.push(insertOrUpdateInstances(cb));
	actions.push(insertOrUpdateLoadBalancers());


	// Execute all functions in 'actions' array
	async.waterfall(
		actions,
		function(err, result){
			if(err) {
				// console.log(err);
			} else {
				// console.log('DONE');

				// Delete old instances/loadBalancers
				AwsInstance.deleteMarked();
				AwsLoadBalancer.deleteMarked();
			}
		}
	);
}

// =================================================================
// instances =======================================================
// =================================================================

// Get all instances for specified awsCredentials/region
describeInstances = function(ec2) {

	return function(callback) {
		var params = {};

		ec2.describeInstances(params, function(err, data) {
			if (err) callback(err); // an error occurred
			
			else {
				// Loop through all reservations
				for (var i in data.Reservations) {
					var reservation = data.Reservations[i];

					// Loop through all reservation instances
					// Modify instances and push them to 'instances' array
					for (var j in reservation.Instances) {
						var instance = reservation.Instances[j];

						instance.id = instance.InstanceId;
						instance.ReservationId = reservation.ReservationId;
						instance.OwnerId = reservation.OwnerId;
						instance.Groups = reservation.Groups;

						instances.push(instance);
					}
				}

				// All instances are processed
				callback(null);
			}
		});
	}

}

// insert or update all instances
insertOrUpdateInstances = function(cb) {

	return function(callBack) {
		var instanceActions = [];

		// Insert each instance
		for(var i in instances) {
			instanceActions.push(insertOrUpdateInstance(instances[i], cb));
		}

		// Execute all functions in 'instanceActions' array
		async.waterfall(
			instanceActions,
			function(err, result){
				if(err)
					callBack(err);
				else 
					callBack(null);
			}
		);
	}

}

// insert or update instance
insertOrUpdateInstance = function(instance, cb) {

	return function(callback) {
		AwsInstance.insertOrUpdate(instance.id, instance, function(err, instance){
			if(err) callback(err);

			else {
				// Instance is related to monitorClient -> create moduleData and callback
				if(instance.monitorClientId && instance.monitorClientId != "") {
					var monitorClientId = instance.monitorClientId;
					delete instance.monitorClientId;

					var moduleData = {
						monitorClientId: monitorClientId,
						data: instance
					};

					cb(null, moduleData); // callback to moduleManager
				}

				callback(null);
			}
		});
	}

}

// =================================================================
// loadBalancers ===================================================
// =================================================================

// Get all loadBalancers including Instances Health for specified awsCredentials/region
describeLoadBalancersWithInstanceHealth = function(elb) {

	return function(cb) {
		describeLoadBalancers(elb, function(err, lBalancers){
			if (err) callback(err)

			else {
				var healthActions = [];

				// Get instancesHealth for each loadBalancer
				for(var i in lBalancers) {
					healthActions.push(describeInstanceHealth(elb, lBalancers[i]));
				}

				// Execute all functions in 'healthActions' array
				async.waterfall(
					healthActions,
					function(err, result){
						if(err)
							cb(err);
						else 
							cb(null);
					}
				);
			}
		});
	}

}

// Get loadBalancers for specified awsCredentials/region
describeLoadBalancers = function(elb, callback) {
	var params = {};

	elb.describeLoadBalancers(params, function(err, data) {
		if (err) callback(err); // an error occurred

		else {
			lBalancers = data.LoadBalancerDescriptions;

			// Create an id property in each loadBalancer
			for(var i in lBalancers) {
				lBalancers[i].id = lBalancers[i].LoadBalancerName;
			}

			callback(null, lBalancers);
		}
	});
}

// get Instances Health for specified loadBalancer and awsCredentials/region
describeInstanceHealth = function(elb, loadBalancer) {

	return function(callback) {
		// LoadBalancer has Instances, get InstanceHealth
		if(loadBalancer.Instances.length > 0 ) {
			var params = {
				LoadBalancerName: loadBalancer.LoadBalancerName,
				Instances: loadBalancer.Instances
			};

			elb.describeInstanceHealth(params, function(err, data) {
				if (err) callback(err); // an error occurred

				else {
					loadBalancer.Instances = data.InstanceStates;

					loadBalancers.push(loadBalancer);
					callback(null);
				}
			});
		
		} else {
			// LoadBalancer has no Instances, push anyway
			loadBalancers.push(loadBalancer);
			callback(null);
		}
	}

}

// insert or update all loadBalancers
insertOrUpdateLoadBalancers = function(cb) {

	return function(callBack) {
		var loadBalancerActions = [];

		// Insert each loadBalancer
		for(var i in loadBalancers) {
			loadBalancerActions.push(insertOrUpdateLoadBalancer(loadBalancers[i], cb));
		}

		// Execute all functions in 'loadBalancerActions' array
		async.waterfall(
			loadBalancerActions,
			function(err, result){
				if(err)
					callBack(err);
				else 
					callBack(null);
			}
		);
	}

}

// insert or update loadBalancer
insertOrUpdateLoadBalancer = function(loadBalancer, cb) {

	return function(callback) {
		AwsLoadBalancer.insertOrUpdate(loadBalancer.id, loadBalancer, function(err, loadBalancer){
			if(err) 
				callback(err);
			else
				callback(null);
		});
	}

}

// Specify routes for registering in Monitor through moduleManager
exports.getRoutes = function () {
	return [
		{method: 'GET', pattern: '/module/monitorAws/instances', function: routeGetAllInstances},
		{method: 'POST', pattern: '/module/monitorAws/instances/update', function: routeUpdateInstance},
		{method: 'GET', pattern: '/module/monitorAws/loadBalancers', function: routeGetAllLoadBalancers}
	];
}

// Get all Instances
var routeGetAllInstances = function(req, res, next) {

	// Protected route (only admins)
	if(req.user && req.user.role != 'admin')
		return res.status(401).json(responseMessaging.format(401));

	AwsInstance.getAll(function(err, awsInstances){
		if(err)
			res.status(500).json(responseMessaging.format(500, {}, [err]));
		else
			res.status(200).json(responseMessaging.format(200, awsInstances));
	});

}

// Update instance
var routeUpdateInstance = function(req, res, next) {

	// Protected route (only admins)
	if(req.user && req.user.role != 'admin')
		return res.status(401).json(responseMessaging.format(401));

	var id = req.body.id;
	var data = {
		monitorClientId: req.body.monitorClientId
	};

	AwsInstance.update(id, data, function(err, awsInstance){
		if(err)
			res.status(500).json(responseMessaging.format(500, {}, [err]));
		else			
			res.status(200).json(responseMessaging.format(200, awsInstance));
	});

};

// Get all LoadBalancers
var routeGetAllLoadBalancers = function(req, res, next) {

	// Protected route (only admins)
	if(req.user && req.user.role != 'admin')
		return res.status(401).json(responseMessaging.format(401));

	AwsLoadBalancer.getAll(function(err, awsLoadBalancers){
		if(err)
			res.status(500).json(responseMessaging.format(500, {}, [err]));
		else
			res.status(200).json(responseMessaging.format(200, awsLoadBalancers));
	});

}