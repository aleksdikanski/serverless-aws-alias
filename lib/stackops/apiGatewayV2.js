'use strict';

/**
 * Handle ApiGatewayV2 (WebSocket) resources.
 * Keep all resources that are used somewhere and remove the ones that are not
 * referenced anymore.
 */

const _ = require('lodash');
const BbPromise = require('bluebird');

const CF_TYPE = 'Type';

function exportApiForAliasStacks(stageStack, stackName) {
	stageStack.Outputs.WebsocketsApi = {
		Description: 'WebSockets API Gateway',
		Value: { Ref: 'WebsocketsApi' },
		Export: {
			Name: `${stackName}-ApiGatewayWebsocketsApi`
		}
	};
}

module.exports = function(currentTemplate, aliasStackTemplates, currentAliasStackTemplate) {
	const stackName = this._provider.naming.getStackName();
	const stageStack = this._serverless.service.provider.compiledCloudFormationTemplate;
	const aliasStack = this._serverless.service.provider.compiledCloudFormationAliasTemplate;
	// const userResources = _.get(this._serverless.service, 'resources', { Resources: {}, Outputs: {} });

	// Check if our current deployment includes a WebSocket deployment
	let exposeApi = _.includes(_.keys(stageStack.Resources), 'WebsocketsApi');
	const aliasResources = [];

	if (!exposeApi) {
		// Check if we have any aliases deployed that reference the API.
		if (_.some(aliasStackTemplates, template => _.find(template.Resources, [ 'Type', 'AWS::ApiGatewayV2::Deployment' ]))) {
			// Fetch the WebSockets-Api resource from the current stack
			stageStack.Resources.WebsocketsApi = currentTemplate.Resources.WebsocketsApi;
			exposeApi = true;
		}
	}
	if (exposeApi) {
		this.options.verbose && this._serverless.cli.log('Processing Websocket API');

		exportApiForAliasStacks(stageStack, stackName);

		// Move the API deployment and stage into the alias stack.
		// The alias is the owner of the APIGv2 stage.
		const deploymentResource = _.assign({}, _.pickBy(stageStack.Resources, [ CF_TYPE, 'AWS::ApiGatewayV2::Deployment' ]));
		const stageResource = _.assign({}, _.pickBy(stageStack.Resources, [ CF_TYPE, 'AWS::ApiGatewayV2::Stage' ]));

		if (!_.isEmpty(deploymentResource) && !_.isEmpty(stageResource)) {
			const deploymentName = _.keys(deploymentResource)[0];
		
			const deploymentObj = deploymentResource[deploymentName];
			deploymentObj.Properties.ApiId = { 'Fn::ImportValue': `${stackName}-ApiGatewayWebsocketsApi` };
			// Deployment usually depends on the Route definitions
			// Decided not to explicitly link the deployments to exported values from main stack
			deploymentObj.DependsOn = [];
			
			const stageResourceName = _.keys(stageResource)[0];
			const stageObj = stageResource['WebsocketsDeploymentStage'];
			stageObj.Properties.ApiId = { 'Fn::ImportValue': `${stackName}-ApiGatewayWebsocketsApi` };
			stageObj.Properties.StageName = _.replace(this._alias, /-/g, '_');
			stageObj.Properties.StageVariables = _.assign({
				SERVERLESS_ALIAS: this._alias,
				SERVERLESS_STAGE: this._stage
			}, stageObj.Properties.StageVariables || {});

			aliasResources.push(deploymentResource);
			aliasResources.push(stageResource);

			_.unset(stageStack, `Resources.${stageResourceName}`);
			_.unset(stageStack, `Resources.${deploymentName}`);
		}
	}

	_.forEach(aliasResources, resource => _.assign(aliasStack.Resources, resource));
	return BbPromise.resolve([ currentTemplate, aliasStackTemplates, currentAliasStackTemplate ]);
};