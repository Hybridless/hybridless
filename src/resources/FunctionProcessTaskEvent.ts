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
    const environment = (<OFunctionProcessTaskEvent>this.event).runtime;
    const customDockerFile = (<OFunctionProcessTaskEvent>this.event).dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = ((<OFunctionProcessTaskEvent>this.event).additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: serverlessDir, dest: file.to }
    });
    //Get build directory (todo: figureout oneliner)
    let safeDir: any = __dirname.split('/');
    safeDir.splice(safeDir.length - 1, 1);
    safeDir = safeDir.join('/');
    //Nodejs Specific
    if (environment == OFunctionProcessTaskRuntime.nodejs10 || environment == OFunctionProcessTaskRuntime.nodejs13) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.Process_ImageByRuntime(environment), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        (this.plugin.options.disableWebpack ?
          { name: '.', dir: serverlessDir, dest: '/usr/src/app' } :
          { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }),
        ...additionalDockerFiles
      ];
    } else if (environment == OFunctionProcessTaskRuntime.container) {
      return [
        { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
        ...additionalDockerFiles
      ];
    } else {
      throw new Error(`Unrecognized Process event type ${environment}!`);
    }
  }
  protected getContainerEnvironments(): any {
    const event: OFunctionProcessTaskEvent = (<OFunctionProcessTaskEvent>this.event);
    return {
      'ENTRYPOINT': this.func.getEntrypoint(this.event),
      'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
      'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1,
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
    const ECRRepoFullURL = await this._getFullECRRepoImageURL();
    const event: OFunctionProcessTaskEvent = (<OFunctionProcessTaskEvent>this.event);
    return new BPromise(async (resolve) => {
      resolve({
        name: TaskName,
        cpu: (event.cpu || Globals.Process_DefaultCPU),
        memory: (event.memory || this.func.funcOptions.memory || Globals.Process_DefaultMemory),
        disablePublicIPAssign: true,
        ec2LaunchType: !!event.ec2LaunchType,
        ...(!!event.ec2LaunchType && event.daemonType ? { daemonEc2Type: true } : {}),
        taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
        image: `${ECRRepoFullURL}`,
        ...(event.entrypoint ? { entrypoint: event.entrypoint } : {}),
        desiredCount: (event.concurrency || Globals.Process_DefaultConcurrency),
        environment: {
          ...this.plugin.getEnvironmentIvars(),
          ...this.getContainerEnvironments(),
        },
        logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
      });
    });
  }
}