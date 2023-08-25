import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionBatchJobTypes, OFunctionBatchJobEvent, OFunctionBatchJobRuntime } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionBatchJobEvent extends FunctionContainerBaseEvent {
  private logGroupName: String;
  public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionBatchJobEvent, index: number) {
    super(plugin, func, event, index);
    this.logGroupName = `/aws/batch/job/${this.plugin.getName()}${this.func.getName()}/${this.plugin.stage}/${index}`;
  }
  /* Base Event Overwrites */
  public async spread(): BPromise {
    return new BPromise(async (resolve) => {
      //generate log group
      const logGroup = this._generateLogGroup();
      if (logGroup) this.plugin.appendResource(this._getJobName('LogGroup'), logGroup);
      //generate job definition
      const jobDefinition = await this._generateJobDefinition();
      if (jobDefinition) this.plugin.appendResource(this._getJobName(), jobDefinition);
      //
      resolve();
    });
  }
  public async checkDependencies(): BPromise {
		return new BPromise(async (resolve, reject) => {
			await super.checkDependencies();
			if (this.event.logsRetentionInDays) this.plugin.depManager.enableLogsRetention();
			resolve();
		});
	}
  /* Container Base Event Overwrites */
  protected getContainerFiles(): DockerFiles {
    const event: OFunctionBatchJobEvent = (<OFunctionBatchJobEvent>this.event);
    const customDockerFile = event.dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = ((<OFunctionBatchJobEvent>this.event).additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: serverlessDir, dest: file.to }
    });
    //Envs
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    const isJava = (event && event.runtime && event.runtime.toLowerCase().indexOf('java') != -1);
    const isPureContainer = (event.runtime == OFunctionBatchJobRuntime.container);
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
          { name: Globals.BatchJob_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        { name: 'job-batch/Index-Job-NodejsX', dir: safeDir + '/resources/assets', dest: 'proxy.js' },
        (this.plugin.options.disableWebpack ?
          { name: '.', dir: serverlessDir, dest: '/usr/src/app' } :
          { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }),
        ...additionalDockerFiles
      ];
    }  else if (isJava) {
      return [
        (customDockerFile ?
          { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
          { name: Globals.BatchJob_ImageByRuntime(event.runtime), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
        ),
        { name: 'job-batch/Index-Job-JavaX', dir: safeDir + '/resources/assets', dest: 'hybridless-entrypoint.sh' },
        { name: 'target/classes', dir: serverlessDir, dest: 'target/classes' },
        { name: 'target/dependency', dir: serverlessDir, dest: 'target/dependency' },
        ...additionalDockerFiles
      ];
    }  else if (isPureContainer) {
      return [
        { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
        ...additionalDockerFiles
      ];
    } else {
      throw new Error(`Unrecognized LambdaContainer event type ${event.runtime}!`);
    }
  }
  protected getContainerEnvironments(): any {
    const event: OFunctionBatchJobEvent = (<OFunctionBatchJobEvent>this.event);
    const isNodeJS = (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1);
    return {
      'HYBRIDLESS_RUNTIME': true,
      ...(isNodeJS ? {'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1} : {}),
      'ENTRYPOINT': `${this.func.getEntrypoint(this.event)}`,
      'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
      // Batch specific
      ...(this.func.funcOptions.timeout || event.timeout ? {'TIMEOUT': event.timeout || this.func.funcOptions.timeout  } : {}),
      // Configs
      ...event.cpu ? { 'CPU': (event.cpu || Globals.HTTPD_DefaultCPU) } : {},
      ...(event.memory || this.func.funcOptions.memory) ? { 'MEMORY': (event.memory || this.func.funcOptions.memory) } : {},
      // General
      'STAGE': this.plugin.stage,
      'ECS_ENABLE_CONTAINER_METADATA': true,
      'AWS_ACCOUNT_ID': { "Ref": "AWS::AccountId" },
      'AWS_REGION': { "Ref": "AWS::Region" },
      ...(this.func.funcOptions.environment || {}),
      ...(event.environment || {}),
    };
  }
  protected getContainerBuildArgs(): { [key: string]: string } | null { return (<OFunctionBatchJobEvent>this.event).dockerBuildArgs; }
  /* cloudformation resources */
  private async _generateJobDefinition(): BPromise<any> {
    const event: OFunctionBatchJobEvent = (<OFunctionBatchJobEvent>this.event);
    const repoName = await this.getContainerImageURL();
    const environment = { ...this.plugin.getEnvironmentIvars(), ...this.getContainerEnvironments() };
    return {
      Type: "AWS::Batch::JobDefinition",
      DependsOn: [ this._getJobName('LogGroup') ],
      Properties: {
        Type: event.type || OFunctionBatchJobTypes.container,
        RetryStrategy: { ...(event.retryCount ? { Attempts: event.retryCount } : { Attempts: Globals.BatchJob_DefaultAttempts }) },
        ...(event.propagateTags ? { PropagateTags: event.propagateTags } : {}),
        ...(event.tags ? { Tags: event.tags } : {}),
        ...(this.func.funcOptions.timeout || event.timeout ? 
            { Timeout: { AttemptDurationSeconds: event.timeout || this.func.funcOptions.timeout } } : {}),
        Parameters: { "inputEvent": "{}" },
        PlatformCapabilities: [ event.runsOnFargate ? 'FARGATE' : 'EC2' ],
        ContainerProperties: {
          Command: [ "Ref::inputEvent" ],
          Environment: Object.keys(environment).map((k) => ({Name: k, Value: environment[k]})),
          JobRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
          ...(event.runsOnFargate ? { ExecutionRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }) } : {}),
          Image: repoName,
          Privileged: false,
          ...(event.softCPU ? {
              "Ulimits": [ { "SoftLimit": event.softCPU, "Name": "cpu", "HardLimit": -1 } ]
          } : {}),
          LogConfiguration: {
            LogDriver: "awslogs",
            Options: {
                "awslogs-group": this.logGroupName,
                "awslogs-region": {
                    "Ref": "AWS::Region"
                },
                'awslogs-multiline-pattern': (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
            }
          },
          ReadonlyRootFilesystem: false,
          ...((this.func.funcOptions.memory || event.memory) || event.cpu ? {
            ResourceRequirements: []
              .concat(event.cpu ? [{ Type: "VCPU", Value: event.cpu }] : [])
              .concat((event.memory || this.func.funcOptions.memory) ? [{ Type: "MEMORY", Value: event.memory || this.func.funcOptions.memory }] : [])
          } : {}),
        },
      }
    };
  }
  private _generateLogGroup(): any {
    return {
      Type: 'AWS::Logs::LogGroup',
      DeletionPolicy: "Delete",
      Properties: {
        LogGroupName: this.logGroupName,
        RetentionInDays: this.event.logsRetentionInDays || Globals.DefaultLogRetetionInDays
      }
    }
  }

  /* Events */
  private _getJobName(suffix?: string): string {
    return `${this.plugin.getName()}${this.func.getName()}${this.plugin.stage}${this.index || ''}` + (suffix || '');
  }
}