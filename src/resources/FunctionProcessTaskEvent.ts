import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionProcessTaskEvent, OFunctionProcessTaskRuntime } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionProcessTaskEvent extends FunctionContainerBaseEvent {
  public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionProcessTaskEvent, index: number) {
    super(plugin, func, event, index);
  }
  /* Container Base Event Overwrites */
  protected getContainerFiles(): DockerFiles {
    const event: OFunctionProcessTaskEvent = (<OFunctionProcessTaskEvent>this.event);
    const customDockerFile = event.dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = (event.additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: serverlessDir, dest: file.to }
    });
    //Get build directory (todo: figureout oneliner)
    let safeDir: any = __dirname.split('/');
    safeDir.splice(safeDir.length - 1, 1);
    safeDir = safeDir.join('/');
    //Envs
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    const isJava = (event && event.runtime && event.runtime.toLowerCase().indexOf('java') != -1);
    const isPureContainer = (event.runtime == OFunctionProcessTaskRuntime.container);
    //Nodejs Specific
    if (isNodeJS) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.Process_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
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
          { name: Globals.Process_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        { name: 'target/classes', dir: serverlessDir, dest: 'target/classes' },
        { name: 'target/dependency', dir: serverlessDir, dest: 'target/dependency' },
        ...additionalDockerFiles
      ];
    } else if (isPureContainer) {
      return [
        { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
        ...additionalDockerFiles
      ];
    } else {
      throw new Error(`Unrecognized Process event type ${event.runtime}!`);
    }
  }
  protected getContainerEnvironments(): any {
    const event: OFunctionProcessTaskEvent = (<OFunctionProcessTaskEvent>this.event);
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    return {
      'HYBRIDLESS_RUNTIME': true,
      'ENTRYPOINT': this.func.getEntrypoint(this.event),
      'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
      ...(isNodeJS ? { 'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1 } : {}),
      // Analytics
      ...(event.newRelicKey ? {
        'NEW_RELIC_APP_NAME': `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
        'NEW_RELIC_LICENSE_KEY': event.newRelicKey,
        'NEW_RELIC_ENABLED': true,
        'NEW_RELIC_NO_CONFIG_FILE': true,
      } : {
        'NEW_RELIC_ENABLED': false
      }),
      // Configs
      'CPU': (event.cpu || Globals.Process_DefaultCPU),
      'MEMORY': (event.memory || this.func.funcOptions.memory || Globals.Process_DefaultMemory),
      // General
      'STAGE': this.plugin.stage,
      'AWS_REGION': { "Ref": "AWS::Region" },
      'AWS_ACCOUNT_ID': { "Ref": "AWS::AccountId" },
      'ECS_ENABLE_CONTAINER_METADATA': true,
      ...(this.func.funcOptions.environment || {}),
      ...(event.environment || {}),
    };
  }
  public async getClusterTask(): BPromise {
    const TaskName = this._getTaskName();
    const ECRRepoFullURL = await this.getContainerImageURL();
    const event: OFunctionProcessTaskEvent = (<OFunctionProcessTaskEvent>this.event);
    return new BPromise(async (resolve) => {
      resolve({
        name: TaskName,
        cpu: (event.cpu || Globals.Process_DefaultCPU),
        memory: (event.memory || this.func.funcOptions.memory || Globals.Process_DefaultMemory),
        ec2LaunchType: !!event.ec2LaunchType,
        ...(!!event.ec2LaunchType && event.daemonType ? { daemonEc2Type: true } : {}),
        ...(!event.ec2LaunchType ? { disablePublicIPAssign: true } : {}),
        taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
        image: `${ECRRepoFullURL}`,
        ...(event.entrypoint ? { entrypoint: event.entrypoint } : {}),
        desiredCount: (event.concurrency || Globals.Process_DefaultConcurrency),
        environment: {
          ...this.plugin.getEnvironmentIvars(),
          ...this.getContainerEnvironments(),
        },
        //default stuff
        logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
        ...(event.logsRetentionInDays && <unknown>event.logsRetentionInDays != 'null' ? { logsRetentionInDays: event.logsRetentionInDays } : {}),
        ...(event.placementStrategies && <unknown>event.placementStrategies != 'null' ? { placementStrategies: event.placementStrategies } : {}),
        ...(event.placementConstraints && <unknown>event.placementConstraints != 'null' ? { placementConstraints: event.placementConstraints } : {}),
        ...(event.capacityProviderStrategy && <unknown>event.capacityProviderStrategy != 'null' ? { capacityProviderStrategy: event.capacityProviderStrategy } : {}),
        ...(event.propagateTags && <unknown>event.propagateTags != 'null' ? { propagateTags: event.propagateTags } : {}),
      });
    });
  }
}