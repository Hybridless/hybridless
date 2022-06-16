import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionLaunchableTaskEvent, OFunctionLaunchableTaskRuntime } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionLaunchableTaskEvent extends FunctionContainerBaseEvent {
  public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionLaunchableTaskEvent, index: number) {
    super(plugin, func, event, index);
  }
  /* Container Base Event Overwrites */
  protected getContainerFiles(): DockerFiles {
    const event: OFunctionLaunchableTaskEvent = (<OFunctionLaunchableTaskEvent>this.event);
    const customDockerFile = (<OFunctionLaunchableTaskEvent>this.event).dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = ((<OFunctionLaunchableTaskEvent>this.event).additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: serverlessDir, dest: file.to }
    });
    //Get build directory (todo: figureout oneliner)
    let safeDir: any = __dirname.split('/');
    safeDir.splice(safeDir.length - 1, 1);
    safeDir = safeDir.join('/');
    //Envs
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    const isJava = (event && event.runtime && event.runtime.toLowerCase().indexOf('java') != -1);
    const isPureContainer = (event.runtime == OFunctionLaunchableTaskRuntime.container);
    //Nodejs Specific
    if (isNodeJS) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.Launchable_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        (this.plugin.options.disableWebpack ?
          { name: '.', dir: serverlessDir, dest: '/usr/src/app' } :
          { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }),
        ...additionalDockerFiles
      ];
    } if (isJava) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.Launchable_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
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
      throw new Error(`Unrecognized Launchable event type ${event.runtime}!`);
    }
  }
  protected getContainerEnvironments(): any {
    const event: OFunctionLaunchableTaskEvent = (<OFunctionLaunchableTaskEvent>this.event);
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
      // General
      'STAGE': this.plugin.stage,
      'AWS_REGION': { "Ref": "AWS::Region" },
      'AWS_ACCOUNT_ID': { "Ref": "AWS::AccountId" },
    };
  }
  public async getClusterTask(): BPromise {
    const TaskName = this._getTaskName();
    const ECRRepoFullURL = await this.getContainerImageURL();
    const event: OFunctionLaunchableTaskEvent = (<OFunctionLaunchableTaskEvent>this.event);
    return new BPromise(async (resolve) => {
      resolve({
        name: TaskName,
        cpu: (event.cpu || Globals.Launchable_DefaultCPU),
        memory: (event.memory || this.func.funcOptions.memory || Globals.Launchable_DefaultMemory),
        ec2LaunchType: !!event.ec2LaunchType,
        ...(!!event.ec2LaunchType && event.daemonType ? { daemonEc2Type: false } : {}),
        ...(!event.ec2LaunchType ? { disablePublicIPAssign: true } : {}),
        taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
        image: `${ECRRepoFullURL}`,
        ...(event.entrypoint ? { entrypoint: event.entrypoint } : {}),
        desiredCount: 0, //runs on demand
        environment: {
          ...this.plugin.getEnvironmentIvars(),
          ...this.getContainerEnvironments(),
        },
        //default stuff
        ...(event.placementStrategies && <unknown>event.placementStrategies != 'null' ? { placementStrategies: event.placementStrategies } : {}),
        ...(event.placementConstraints && <unknown>event.placementConstraints != 'null' ? { placementConstraints: event.placementConstraints } : {}),
        ...(event.capacityProviderStrategy && <unknown>event.capacityProviderStrategy != 'null' ? { capacityProviderStrategy: event.capacityProviderStrategy } : {}),
        ...(event.propagateTags && <unknown>event.propagateTags != 'null' ? { propagateTags: event.propagateTags } : {}),
        logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
        ...(event.logsRetentionInDays && <unknown>event.logsRetentionInDays != 'null' ? { logsRetentionInDays: event.logsRetentionInDays } : {}),
      });
    });
  }
}