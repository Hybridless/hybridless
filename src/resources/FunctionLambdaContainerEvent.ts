import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionLambdaCloudWatchEvent, OFunctionLambdaCloudWatchLogStream, OFunctionLambdaCognitoTrigger, OFunctionLambdaContainerEvent, OFunctionLambdaContainerRuntime, OFunctionLambdaEvent, OFunctionLambdaHTTPEvent, OFunctionLambdaHTTPLoadBalancerEvent, OFunctionLambdaProtocol, OFunctionLambdaS3Event, OFunctionLambdaSchedulerEvent, OFunctionLambdaSNSEvent, OFunctionLambdaSQSEvent } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionLambdaContainerEvent extends FunctionContainerBaseEvent {
  public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionLambdaContainerEvent, index: number) {
    super(plugin, func, event, index);
  }
  /* Base Event Overwrites */
  public async spread(): BPromise {
    return new BPromise(async (resolve) => {
      //generate lambda
      const lambda = await this._generateLambdaFunction();
      this.plugin.appendServerlessFunction(lambda);
      //Check if needs authorizer
      const authorizer = this._generateCognitoAuthorizer();
      if (authorizer) this.plugin.appendResource(this._getAuthorizerName(), authorizer);
      //Check if using protocol httpAlb and listenerArn is not available
      if ((this.event as OFunctionLambdaEvent).protocol == OFunctionLambdaProtocol.httpAlb &&
        !this.func.funcOptions.albListenerArn) {
        this.plugin.logger.error(`Function event of type httpAlb does require upper element (function) to have albListenerArn set! can't continue.`);
      }
      resolve();
    });
  }
  /* Container Base Event Overwrites */
  protected getContainerFiles(): DockerFiles {
    const event: OFunctionLambdaContainerEvent = (<OFunctionLambdaContainerEvent>this.event);
    const customDockerFile = event.dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = ((<OFunctionLambdaContainerEvent>this.event).additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: serverlessDir, dest: file.to }
    });
    //Envs
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    const isJava = (event && event.runtime && event.runtime.toLowerCase().indexOf('java') != -1);
    const isPureContainer = (event.runtime == OFunctionLambdaContainerRuntime.container);
    //Get build directory
    let safeDir: any = __dirname.split('/');
    safeDir.splice(safeDir.length - 1, 1);
    safeDir = safeDir.join('/');
    //
    //Nodejs Specific
    if (isNodeJS) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.LambdaContainer_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        (this.plugin.options.disableWebpack ?
          { name: '.', dir: serverlessDir, dest: '/usr/src/app' } :
          { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }),
        ...additionalDockerFiles
      ];
    } else if (isJava) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.LambdaContainer_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        { name: 'target', dir: serverlessDir, dest: 'target' },
        ...additionalDockerFiles
      ];
    } else if (isPureContainer) {
      return [
        { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
        ...additionalDockerFiles
      ];
    } else {
      throw new Error(`Unrecognized LambdaContainer event type ${event.runtime}!`);
    }
  }
  protected getContainerEnvironments(): any {
    const event: OFunctionLambdaContainerEvent = (<OFunctionLambdaContainerEvent>this.event);
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    return {
      ...(isNodeJS ? {'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1} : {}),
      'ENTRYPOINT': `${this.func.getEntrypoint(this.event)}`,
      'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
      //When using ALB with lambda, CORS should be implemented at code level (this might be a wrong assumption, more reasearch is needed)
      ...(event.protocol == OFunctionLambdaProtocol.httpAlb && (this.event as OFunctionLambdaHTTPLoadBalancerEvent).cors ? { 'CORS': JSON.stringify((this.event as OFunctionLambdaHTTPLoadBalancerEvent).cors) } : {}),
      // General
      'STAGE': this.plugin.stage,
      'AWS_ACCOUNT_ID': { "Ref": "AWS::AccountId" },
    };
  }
  /* lambda helpers */
  private async _generateLambdaFunction(): BPromise<any> {
    const event: OFunctionLambdaContainerEvent = (<OFunctionLambdaContainerEvent>this.event);
    const repoName = await this._getFullECRRepoImageURL();
    if (!event.protocol) this.plugin.logger.error(`Missing protocol for lambda container event ${this._getFunctionName()}. Can't continue!`);
    return {
      [this._getFunctionName()]: {
        name: `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
        //container
        image: repoName,
        environment: {
          ...this.plugin.getEnvironmentIvars(),
          ...this.getContainerEnvironments(),
        },
        //default stuff
        ...this.func.getVPC(true, true),
        ...(this.func.funcOptions.timeout ? { timeout: this.func.funcOptions.timeout } : { timeout: Globals.HTTPD_DefaultTimeout }),
        ...(this.func.funcOptions.memory || event.memory ? { memorySize: this.func.funcOptions.memory || event.memory } : {}),
        ...(event.reservedConcurrency ? { reservedConcurrency: event.reservedConcurrency } : {}),
        tracing: (event.disableTracing ? false : true), //enable x-ray tracing by default,
        //Lambda events means routes on this scope
        ...this._getLambdaEvents(event)
      }
    };
  }

  /* Events */
  private _getLambdaEvents(event): object {
    //No events are required for protocol none
    if (event.protocol == OFunctionLambdaProtocol.none) return { events: [] };
    //Check if should loop into routes (as events) or falsify the event to spread the required resource
    const acceptsRouting = (event.protocol == OFunctionLambdaProtocol.http || event.protocol == OFunctionLambdaProtocol.httpAlb);
    const sanitizedRoutes = (acceptsRouting ? (this.event as OFunctionLambdaHTTPEvent || this.event as OFunctionLambdaHTTPLoadBalancerEvent).routes : [null]); //important, leave one null object if not http
    return (sanitizedRoutes && sanitizedRoutes.length > 0 ? {
      events: sanitizedRoutes.map((route) => {
        return {
          [this._getProtocolName(event.protocol)]: {
            //multiple
            ...((this.event as OFunctionLambdaSNSEvent).protocolArn ? { arn: (this.event as OFunctionLambdaSNSEvent).protocolArn } : {}),
            //sqs
            ...((this.event as OFunctionLambdaSQSEvent).queueBatchSize ? { batchSize: (this.event as OFunctionLambdaSQSEvent).queueBatchSize } : {}),
            //ddbstreams
            ...((<OFunctionLambdaContainerEvent>this.event).protocol == OFunctionLambdaProtocol.dynamostreams ? { type: 'dynamodb' } : {}),
            //scheduler
            ...((this.event as OFunctionLambdaSchedulerEvent).schedulerRate ? { rate: (this.event as OFunctionLambdaSchedulerEvent).schedulerRate } : {}),
            ...((this.event as OFunctionLambdaSchedulerEvent).schedulerInput ? {
              input:
                typeof (this.event as OFunctionLambdaSchedulerEvent).schedulerInput == 'string' ?
                  (this.event as OFunctionLambdaSchedulerEvent).schedulerInput : JSON.stringify((this.event as OFunctionLambdaSchedulerEvent).schedulerInput)
            } : {}),
            //sns
            ...((this.event as OFunctionLambdaSNSEvent).filterPolicy ? { filterPolicy: (this.event as OFunctionLambdaSNSEvent).filterPolicy } : {}),
            //s3
            ...((this.event as OFunctionLambdaS3Event).s3bucket ? {
              s3: {
                bucket: (this.event as OFunctionLambdaS3Event).s3bucket,
                ...((this.event as OFunctionLambdaS3Event).s3event ? { event: (this.event as OFunctionLambdaS3Event).s3event } : {}),
                ...((this.event as OFunctionLambdaS3Event).s3bucketExisting ? { existing: true } : {}),
                ...((this.event as OFunctionLambdaS3Event).s3rules ? { rules: (this.event as OFunctionLambdaS3Event).s3rules } : {}),
              }
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
              path: (route.path || '').replace(/\*/g, '{proxy+}'),
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
                path: (route.path || '').replace(/\*/g, '{proxy+}'),
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
    } : {});
  }
  /* Cognito authorizer stuff */
  private _generateCognitoAuthorizer(): any {
    if ((this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn &&
      (this.event as OFunctionLambdaHTTPEvent).protocol == OFunctionLambdaProtocol.http) {
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
    return `${this.plugin.getName()}${this.func.getName()}${this.plugin.stage}` + (suffix || '');
  }
  private _getAuthorizerName(): string {
    return this._getFunctionName('Authorizer');
  }
}