import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionScheduledTaskEvent, OFunctionScheduledTaskRuntime } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionScheduledTaskEvent extends FunctionContainerBaseEvent {
    public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionScheduledTaskEvent, index: number) {
        super(plugin, func, event, index);
    }
    /* Container Base Event Overwrites */
    protected getContainerFiles(): DockerFiles {
        const environment = (<OFunctionScheduledTaskEvent>this.event).runtime;
        const customDockerFile = (<OFunctionScheduledTaskEvent>this.event).dockerFile;
        const serverlessDir = this.plugin.serverless.config.servicePath;
        const additionalDockerFiles = ((<OFunctionScheduledTaskEvent>this.event).additionalDockerFiles || []).map((file) => {
            return { name: file.from, dir: serverlessDir, dest: file.to }
        });
        //Get build directory (todo: figureout oneliner)
        let safeDir: any = __dirname.split('/');
        safeDir.splice(safeDir.length - 1, 1);
        safeDir = safeDir.join('/');
        //Nodejs Specific
        if (environment == OFunctionScheduledTaskRuntime.nodejs10 || environment == OFunctionScheduledTaskRuntime.nodejs13) {
            return [
                (customDockerFile ?
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: Globals.Scheduled_ImageByRuntime(environment), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
                ),
                { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' },
                ...additionalDockerFiles
            ];
        } else if (environment == OFunctionScheduledTaskRuntime.container) {
            return [
                { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
                ...additionalDockerFiles
            ];
        } else {
            throw new Error(`Unrecognized Scheduled event type ${environment}!`);
        }
    }
    protected getContainerEnvironments(): any {
        const event: OFunctionScheduledTaskEvent = (<OFunctionScheduledTaskEvent>this.event);
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
        };
    } 
    public async getClusterTask(): BPromise {
        const TaskName = this._getTaskName();
        const ECRRepoFullURL = await this._getECRRepo(true);
        const event: OFunctionScheduledTaskEvent = (<OFunctionScheduledTaskEvent>this.event);
        return new BPromise(async (resolve) => {
            resolve({
                name: TaskName,
                cpu: (event.cpu || Globals.Scheduled_DefaultCPU),
                memory: (event.memory || this.func.funcOptions.memory || Globals.Scheduled_DefaultMemory),
                disableELB: true,
                ec2LaunchType: !!event.ec2LaunchType,
                ...(!!event.ec2LaunchType && event.daemonType ? { daemonEc2Type: true } : {}),
                taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
                image: `${ECRRepoFullURL}`,
                ...(event.entrypoint ? { entrypoint: event.entrypoint } : {}),
                desiredCount: 0, //runs on demand
                environment: {
                    ...this.plugin.getEnvironmentIvars(),
                    ...this.getContainerEnvironments(),
                },
                logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
                //scheduler
                schedulerRate: event.schedulerRate, //creates event rule to invoke task the concurrency below or if not specified it will use 1
                schedulerConcurrency: (event.concurrency || Globals.Scheduled_DefaultConcurrency),
                ...(event.schedulerInput ? { schedulerInput: event.schedulerInput } : {}),
            });
        });
    }
}