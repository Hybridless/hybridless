import { FunctionBaseEvent } from "./BaseEvents/FunctionBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionLambdaCloudWatchEvent, OFunctionLambdaCloudWatchLogStream, OFunctionLambdaCognitoTrigger, OFunctionLambdaEvent, OFunctionLambdaHTTPEvent, OFunctionLambdaHTTPLoadBalancerEvent, OFunctionLambdaProtocol, OFunctionLambdaS3Event, OFunctionLambdaSchedulerEvent, OFunctionLambdaSNSEvent, OFunctionLambdaSQSEvent } from "../options";
//
import BPromise = require('bluebird');
import Globals from "../core/Globals";
//
export class FunctionLambdaEvent extends FunctionBaseEvent<OFunctionLambdaEvent> {
	public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionLambdaEvent, index: number) {
		super(plugin, func, event, index);
	}
	//Plugin lifecycle
	public async spread(): BPromise {
		return new BPromise(async (resolve) => {
			//generate lambda
			const lambda = this._generateLambdaFunction();
			this.plugin.appendServerlessFunction(lambda);
			//Check if needs authorizer
			const authorizer = this._generateCognitoAuthorizer();
			if (authorizer) this.plugin.appendResource(this._getAuthorizerName(), authorizer);
			resolve();
		});
	}
	public async checkDependencies(): BPromise {
		return new BPromise(async (resolve, reject) => {
			if (this.event.runtime && this.event.runtime.toLowerCase().indexOf('node') != -1 && !this.plugin.options.disableWebpack) this.plugin.depManager.enableWebpack();
			resolve();
		});
	}
	public async createRequiredResources(): BPromise { return BPromise.resolve(); }
	public async build(): BPromise { return BPromise.resolve(); }
	public async push(): BPromise { return BPromise.resolve(); }
	public async cleanup(): BPromise { return BPromise.resolve(); }

	/* lambda helpers */
	private _generateLambdaFunction(): any {
		const acceptsRouting = (this.event.protocol == OFunctionLambdaProtocol.http || this.event.protocol == OFunctionLambdaProtocol.httpAlb);
		const sanitizedRoutes = (acceptsRouting ? (this.event as OFunctionLambdaHTTPEvent || this.event as OFunctionLambdaHTTPLoadBalancerEvent).routes : [null]); //important, leave one null object if not http
		if (!this.event.protocol) this.plugin.logger.error(`Missing protocol for lambda event ${this._getFunctionName()}. Can't continue!`);
		return {
			[this._getFunctionName()]: {
				name: `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}${this.index > 0 ? this.index : ''}`,
				environment: {
					...this.plugin.getEnvironmentIvars(),
					...this._getLambdaEnvironments(),
				},
				//default stuff
				handler: this.event.handler || this.func.funcOptions.handler,
				...this.func.getVPC(true, true),
				...(this.func.funcOptions.timeout ? { timeout: this.func.funcOptions.timeout } : { timeout: Globals.HTTPD_DefaultTimeout }),
				...(this.func.funcOptions.memory || this.event.memory ? { memorySize: this.func.funcOptions.memory || this.event.memory } : {}),
				...(this.event.runtime ? { runtime: this.event.runtime } : {}),
				...(this.event.layers ? { layers: this.event.layers } : {}),
				...(this.event.reservedConcurrency ? { reservedConcurrency: this.event.reservedConcurrency } : {}),
				tracing: (this.event.disableTracing ? false : true), //enable x-ray tracing by default,
				//Lambda events (routes for us)
				...this._getLambdaEvents(sanitizedRoutes)
			}
		};
	}
	/* Events */
	private _getLambdaEvents(sanitizedRoutes): object {
		return (sanitizedRoutes && sanitizedRoutes.length > 0 ? {
			events: sanitizedRoutes.map((route) => {
				return {
					[this._getProtocolName(this.event.protocol)]: {
						//multiple
						...((this.event as OFunctionLambdaSNSEvent).protocolArn ? { arn: (this.event as OFunctionLambdaSNSEvent).protocolArn } : {}),
						//sqs
						...((this.event as OFunctionLambdaSQSEvent).queueBatchSize ? { batchSize: (this.event as OFunctionLambdaSQSEvent).queueBatchSize } : {}),
						//ddbstreams
						...(this.event.protocol == OFunctionLambdaProtocol.dynamostreams ? { type: 'dynamodb' } : {}),
						//scheduler
						...((this.event as OFunctionLambdaSchedulerEvent).schedulerRate ? { rate: [(this.event as OFunctionLambdaSchedulerEvent).schedulerRate] } : {}),
						...((this.event as OFunctionLambdaSchedulerEvent).schedulerInput ? {
							input:
								typeof (this.event as OFunctionLambdaSchedulerEvent).schedulerInput == 'string' ?
									(this.event as OFunctionLambdaSchedulerEvent).schedulerInput : JSON.stringify((this.event as OFunctionLambdaSchedulerEvent).schedulerInput)
						} : {}),
						//sns
						...((this.event as OFunctionLambdaSNSEvent).filterPolicy ? { filterPolicy: (this.event as OFunctionLambdaSNSEvent).filterPolicy } : {}),
						//s3
						...((this.event as OFunctionLambdaS3Event).s3bucket ? {
							bucket: (this.event as OFunctionLambdaS3Event).s3bucket,
							...((this.event as OFunctionLambdaS3Event).s3event ? { event: (this.event as OFunctionLambdaS3Event).s3event } : {}),
							...((this.event as OFunctionLambdaS3Event).s3bucketExisting ? { existing: true } : {}),
							...((this.event as OFunctionLambdaS3Event).s3rules ? { rules: (this.event as OFunctionLambdaS3Event).s3rules } : {}),
						} : {}),
						//cloudwatch
						...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource ? {
							input: (typeof (this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource == 'string' ?
								(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource : JSON.stringify((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource)),
							event: {
								...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource ? { source: [(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource] } : {}),
								...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailType ? { 'detail-type': [(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailType] } : {}),
								...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailState ? { detail: { state: [(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailType] } } : {}),
							}
						} : {}),
						//cloudwatch log streams
						...((this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogGroup ? {
							logGroup: (this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogGroup,
							...((this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogFilter ? { filter: (this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogFilter } : {}),
						} : {}),
						//cognito triggers
						...((this.event as OFunctionLambdaCognitoTrigger).cognitoTrigger ? {
							pool: (this.event as OFunctionLambdaCognitoTrigger).cognitoUserPoolArn,
							trigger: (this.event as OFunctionLambdaCognitoTrigger).cognitoTrigger,
						} : {}),
						//http (API gateway)
						...((this.event as OFunctionLambdaHTTPEvent).protocol == OFunctionLambdaProtocol.http ? {
							path: (route.path == '*' ? '{proxy+}' : route.path),
							method: route.method || 'ANY',
							...((this.event as OFunctionLambdaHTTPEvent).cors ? { cors: (this.event as OFunctionLambdaHTTPEvent).cors } : {}),
							...((this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn ? {
								"authorizer": {
									"type": "COGNITO_USER_POOLS",
									"authorizerId": { "Ref": this._getAuthorizerName() }
								}
							} : {}),
						} : {}),
						//http (load balancer)
						...((this.event as OFunctionLambdaHTTPLoadBalancerEvent).protocol == OFunctionLambdaProtocol.httpAlb ? {
							listenerArn: this.func.funcOptions.albListenerArn,
							priority: route.priority || 1,
							conditions: {
								path: (route.path == '*' ? '{proxy+}' : route.path),
								...(route && route.method ? { method: route.method } : {}),
								...(route && route.hostname ? { host: route.hostname } : {}),
								...((this.event as OFunctionLambdaHTTPLoadBalancerEvent).limitHeader ? {
									header: { name: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).limitHeader.name, values: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).limitHeader.value }
								} : {}),
								...((this.event as OFunctionLambdaHTTPLoadBalancerEvent).limitSourceIPs ? {
									ip: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).limitSourceIPs
								} : {}),
							},
							...((this.event as OFunctionLambdaHTTPLoadBalancerEvent).healthCheckRoute ? {
								healthCheck: {
									path: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).healthCheckRoute,
									intervalSeconds: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).healthCheckInterval || Globals.DefaultHealthCheckInterval,
									timeoutSeconds: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).healthCheckTimeout || Globals.DefaultHealthCheckTimeout,
									healthyThresholdCount: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).healthCheckHealthyCount || Globals.DefaultHealthCheckHealthyCount,
									unhealthyThresholdCount: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).healthCheckUnhealthyCount || Globals.DefaultHealthCheckUnhealthCount,
								}
							} : {}),
							...((this.event as OFunctionLambdaHTTPLoadBalancerEvent).cognitoAuthorizer ? {
								authorizers: {
									authorizer: {
										type: 'cognito',
										userPoolArn: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).cognitoAuthorizer.poolArn,
										userPoolClientId: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).cognitoAuthorizer.clientId,
										userPoolDomain: (this.event as OFunctionLambdaHTTPLoadBalancerEvent).cognitoAuthorizer.poolDomain,
									}
								}
							} : {}),
						} : {}),
					}
				};
			})
		} : {})
	};
	/* Envs */
	private _getLambdaEnvironments(): object {
		return {
			//When using ALB with lambda, CORS should be implemented at code level (this might be a wrong assumption, more reasearch is needed)
			...(this.event.runtime == OFunctionLambdaProtocol.httpAlb && (this.event as OFunctionLambdaHTTPLoadBalancerEvent).cors ? { 'CORS': JSON.stringify((this.event as OFunctionLambdaHTTPLoadBalancerEvent).cors) } : {}),
		};
	}
	/* Cognito authorizer */
	private _generateCognitoAuthorizer(): any {
		if ((this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn) {
			return {
				'Type': 'AWS::ApiGateway::Authorizer',
				'Properties': {
					'AuthorizerResultTtlInSeconds': 300,
					'IdentitySource': 'method.request.header.Authorization',
					'Name': this._getAuthorizerName(),
					'RestApiId': { 'Ref': 'ApiGatewayRestApi' },
					'Type': 'COGNITO_USER_POOLS',
					'ProviderARNs': [(this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn]
				}
			}
		} return null;
	}
	/* Naming */
	private _getProtocolName(proto: OFunctionLambdaProtocol): string {
		if (proto == OFunctionLambdaProtocol.dynamostreams) return 'stream';
		else if (proto == OFunctionLambdaProtocol.scheduler) return 'schedule';
		else if (proto == OFunctionLambdaProtocol.cloudWatch) return 'cloudwatchEvent';
		else if (proto == OFunctionLambdaProtocol.cloudWatchLogstream) return 'cloudwatchLog';
		else if (proto == OFunctionLambdaProtocol.cognito) return 'cognitoUserPool';
		else if (proto == OFunctionLambdaProtocol.httpAlb) return 'alb';
		return proto;
	}
	private _getFunctionName(suffix?: string): string {
		return `${this.plugin.getName()}${this.func.getName()}${this.plugin.stage}${this.index > 0 ? this.index : ''}` + (suffix || '');
	}
	private _getAuthorizerName(): string {
		return this._getFunctionName('Authorizer');
	}
}