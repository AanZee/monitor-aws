exports.isMonitoringModule = true;
exports.hasCron = true;
exports.snapshotData = true;

var Aws = null;

var AWS = require('aws-sdk');
AWS.config.apiVersions = {elb: '2012-06-01'};

// var elb = new AWS.ELB();
var ec2 = null;

/**
 * Module config:
 * 
 * "monitor-pingdom" : {
 *		"user": "",
 *		"pass": "",
 *		"appkey": "",
 *		"cronTime": ""
 * }
 */

// Tables this module need to function
exports.tables = [
	{
		name: 'awsInstances',
		index: [
			'monitorClientId'
		]
	}
];

exports.init = function (db) {
	Aws = require('./models/aws');
	Aws.init(db);
}

exports.executeCron = function (callback) {
	awsCredentials = this.config.credentials;

	// Loop through all awsCredentials
	for (var i in awsCredentials) {
		var AWSConfig = JSON.parse(JSON.stringify(awsCredentials[i])); // duplicate credentials
		var regions = AWSConfig.region;

		// Loop through all regions within awsCredentials
		for (var j in regions) {
			AWSConfig.region = regions[j];
			AWS.config.update(AWSConfig);
			ec2 = new AWS.EC2();

			describeInstances(function(err, result){
				if(err)
					callback(err);
				
				else {
					for (var k in result.Reservations) {
						var reservation = result.Reservations[k];
						
						for (var l in reservation.Instances) {
							var instance = reservation.Instances[l];
							instance.id = instance.InstanceId;
							instance.ReservationId = reservation.ReservationId;
							instance.OwnerId = reservation.OwnerId;

							// Insert/update all in db
							Aws.insertOrUpdateInstance(instance.id, instance, function(err, instance){

								// Instance is related to monitorClient -> create moduleData and callback
								if(instance.monitorClientId) {

									var monitorClientId = instance.monitorClientId;
									delete instance.monitorClientId;

									var moduleData = {
										monitorClientId: monitorClientId,
										data: instance
									};

									callback(null, moduleData);
								}

							});
						}
					}
				}
			});
		}
	};
}

describeInstances = function(callback) {
	var params = {};

	ec2.describeInstances(params, function(err, data) {
		if (err) callback(err); 		// an error occurred
		else     callback(null, data);  // successful response
	});
}