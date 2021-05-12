import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionProcessTaskEvent } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionProcessTaskEvent extends FunctionContainerBaseEvent {
    public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionProcessTaskEvent, index: number) {
        super(plugin, func, event, index);
        plugin.containerFunctions = true;
    }
    /* Container Base Event Overwrites */
    protected getContainerFiles(): DockerFiles {
        return Globals.Process_DockerFilesByRuntime((<OFunctionProcessTaskEvent>this.event).runtime, this.plugin.serverless.config.servicePath, (<OFunctionProcessTaskEvent>this.event).dockerFile);
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
        };
    } 
    public async getClusterTask(): BPromise {
        const TaskName = this._getTaskName();
        const ECRRepoFullURL = await this._getECRRepo(true);
        const event: OFunctionProcessTaskEvent = (<OFunctionProcessTaskEvent>this.event);
        return new BPromise(async (resolve) => {
            resolve({
                name: TaskName,
                cpu: (event.cpu || Globals.Process_DefaultCPU),
                memory: (event.memory || this.func.funcOptions.memory || Globals.Process_DefaultMemory),
                disableELB: true,
                ec2LaunchType: !!event.ec2LaunchType,
                ...(event.autoScale && <unknown>event.autoScale != 'null' ? { autoScale: event.autoScale } : {}),
                taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
                image: `${ECRRepoFullURL}`,
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