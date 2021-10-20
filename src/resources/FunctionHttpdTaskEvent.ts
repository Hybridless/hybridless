import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionHTTPDTaskEvent, OFunctionHttpdTaskRuntime } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionHTTPDTaskEvent extends FunctionContainerBaseEvent {
  private healthRoute: string;
  public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionHTTPDTaskEvent, index: number) {
    super(plugin, func, event, index);
    this.healthRoute = Globals.HTTPD_HealthCheckByRuntime(event.runtime);
  }
  /* Container Base Event Overwrites */
  protected getContainerFiles(): DockerFiles {
    const event: OFunctionHTTPDTaskEvent = (<OFunctionHTTPDTaskEvent>this.event);
    const customDockerFile = event.dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = ((<OFunctionHTTPDTaskEvent>this.event).additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: serverlessDir, dest: file.to }
    });
    //Envs
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    const isPHP = (event && event.runtime && event.runtime.toLowerCase().indexOf('php') != -1);
    const isPureContainer = (event.runtime == OFunctionHttpdTaskRuntime.container);
    //Get build directory
    let safeDir: any = __dirname.split('/');
    safeDir.splice(safeDir.length - 1, 1);
    safeDir = safeDir.join('/');
    //Nodejs Specific
    if (isNodeJS) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.HTTPD_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
        { name: 'task-httpd/Index-Httpd-NodejsX', dir: safeDir + '/resources/assets', dest: 'proxy.js' },
        (this.plugin.options.disableWebpack ?
          { name: '.', dir: serverlessDir, dest: '/usr/src/app' } :
          { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }),
        ...additionalDockerFiles
      ];
    } else if (isPHP) {
      //get handler path and remove index.php 
      const handler = this.event.handler || this.func.funcOptions.handler;
      const handleRootFolder = (handler.indexOf('.php') != -1 ? handler.split('/').splice(0, handler.split('/').length - 1).join('/') : handler);
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.HTTPD_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        { name: 'task-httpd/healthCheck.php', dir: safeDir + '/resources/assets', dest: `/app/${this.healthRoute}` },
        { name: handleRootFolder, dir: serverlessDir, dest: '/app/' },
        ...additionalDockerFiles
      ];
    } else if (isPureContainer) {
      return [
        { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
        ...additionalDockerFiles
      ];
    } else {
      throw new Error(`Unrecognized HTTP event type ${event.runtime}!`);
    }
  }
  protected getContainerEnvironments(): any {
    const event: OFunctionHTTPDTaskEvent = (<OFunctionHTTPDTaskEvent>this.event);
    const isPHP = (event && event.runtime && event.runtime.toLowerCase().indexOf('php') != -1)
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    const isPureContainer = (event.runtime == OFunctionHttpdTaskRuntime.container);
    return {
      //Plataform specific
      ...(isNodeJS && {
        'HYBRIDLESS_RUNTIME': true,
        'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1,
        'ENTRYPOINT': `./${this.func.getEntrypoint(this.event)}`,
        'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
        // Proxy
        ...(event.cors ? { 'CORS': JSON.stringify(event.cors) } : {}),
      }),
      ...(isPHP && {
        'WEB_DOCUMENT_INDEX': this.func.getEntrypointFunction(this.event)
      }),
      ...(isPureContainer && {
        'ENTRYPOINTY': event.entrypoint
      }),
      // Analytics
      ...(event.newRelicKey ? {
        'NEW_RELIC_APP_NAME': `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
        'NEW_RELIC_LICENSE_KEY': event.newRelicKey,
        'NEW_RELIC_ENABLED': true,
        'NEW_RELIC_NO_CONFIG_FILE': true,
      } : {
        'NEW_RELIC_ENABLED': false
      }),
      //
      'TIMEOUT': (this.func.funcOptions.timeout || Globals.HTTPD_DefaultTimeout) * 1000,
      'PORT': this.getPort(),
      // General
      'STAGE': this.plugin.stage,
      'AWS_REGION': { "Ref": "AWS::Region" },
      'AWS_ACCOUNT_ID': { "Ref": "AWS::AccountId" },
      'ECS_ENABLE_CONTAINER_METADATA': true,
      'HEALTH_ROUTE': this.healthRoute,
    };
  }
  public async getClusterTask(): BPromise {
    const TaskName = this._getTaskName();
    const ECRRepoFullURL = await this._getFullECRRepoImageURL();
    const event: OFunctionHTTPDTaskEvent = (<OFunctionHTTPDTaskEvent>this.event);
    return new BPromise(async (resolve) => {
      resolve({
        name: TaskName,
        //Task
        cpu: (event.cpu || Globals.HTTPD_DefaultCPU),
        memory: (event.memory || this.func.funcOptions.memory || Globals.HTTPD_DefaultMemory),
        taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
        image: `${ECRRepoFullURL}`,
        ...(event.entrypoint ? { entrypoint: event.entrypoint } : {}),
        //Service
        desiredCount: (event.concurrency || Globals.HTTPD_DefaultConcurrency),
        ec2LaunchType: !!event.ec2LaunchType,
        ...(!!event.ec2LaunchType && event.daemonType ? { daemonEc2Type: true } : {}),
        environment: {
          ...this.plugin.getEnvironmentIvars(),
          ...this.getContainerEnvironments(),
        },
        ...(event.autoScale && <unknown>event.autoScale != 'null' ? { autoScale: event.autoScale } : {}),
        logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
        ...(event.placementStrategies && <unknown>event.placementStrategies != 'null' ? { placementStrategies: event.placementStrategies } : {}),
        ...(event.placementConstraints && <unknown>event.placementConstraints != 'null' ? { placementConstraints: event.placementConstraints } : {}),
        ...(event.capacityProviderStrategy && <unknown>event.capacityProviderStrategy != 'null' ? { capacityProviderStrategy: event.capacityProviderStrategy } : {}),
        ...(event.propagateTags && <unknown>event.propagateTags != 'null' ? { propagateTags: event.propagateTags } : {}),
        //ALB
        ...(event.hostname && event.hostname != 'null' ? { hostname: event.hostname } : {}),
        ...(event.limitSourceIPs && event.limitSourceIPs != 'null' ? { limitSourceIPs: event.limitSourceIPs } : {}),
        ...(event.limitHeaders ? {
          limitHeaders: event.limitHeaders.map((h) => ({ Name: h.name, Value: h.value }))
        } : {}),
        path: event.routes.map((route: any) => {
          return { path: route.path, method: route.method || 'ANY', priority: route.priority || 1 };
        }),
        //Health check
        healthCheckUri: (event.healthCheckRoute || this.healthRoute),
        healthCheckProtocol: 'HTTP',
        healthCheckInterval: (event.healthCheckInterval || Globals.DefaultHealthCheckInterval),
        healthCheckTimeout: (event.healthCheckTimeout || Globals.DefaultHealthCheckTimeout),
        healthCheckHealthyCount: (event.healthCheckHealthyCount || Globals.DefaultHealthCheckHealthyCount),
        healthCheckUnhealthyCount: (event.healthCheckUnhealthyCount || Globals.DefaultHealthCheckUnhealthCount),
        listeners: [{
          port: this.getPort(),
          albProtocol: (event.certificateArns ? 'HTTPS' : 'HTTP'),
          ...(event.certificateArns ? {
            'certificateArns': event.certificateArns
          } : {}),
          ...(event.certificateArns && event.cognitoAuthorizer ? {
            'authorizer': {
              poolArn: event.cognitoAuthorizer.poolArn,
              clientId: event.cognitoAuthorizer.clientId,
              poolDomain: event.cognitoAuthorizer.poolDomain
            }
          } : {})
        }]
      });
    });
  }

  /* Privates */
  private getPort(): number {
    const event: OFunctionHTTPDTaskEvent = <OFunctionHTTPDTaskEvent>this.event;
    const isPHP = (event.runtime == OFunctionHttpdTaskRuntime.php5 || event.runtime == OFunctionHttpdTaskRuntime.php7);
    return (event.port || ((event.certificateArns && isPHP == false) ? 443 : 80));
  }
}