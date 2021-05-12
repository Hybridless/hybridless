import { OFunction, OFunctionEvent, OFunctionProcessTaskEvent, OFunctionHTTPDTaskEvent, OFunctionEventType, OFunctionContainerRuntime, OFunctionHttpdRuntime } from "../options";
import Hybridless = require("..");
//Event types
import { FunctionProcessEvent } from "./FunctionProcessTaskEvent";
import { FunctionHTTPDEvent } from "./FunctionHttpdTaskEvent";
import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent";
import { FunctionBaseEvent } from "./BaseEvents/FunctionBaseEvent";
import { FunctionLambdaEvent } from "./FunctionLambdaEvent";
import { FunctionLambdaContainerEvent } from "./FunctionLambdaContainerEvent";
//
import _ = require('lodash');
import BPromise = require('bluebird');
import Globals from "../core/Globals";

export class BaseFunction {
    public readonly funcOptions: OFunction;
    private readonly plugin: Hybridless;
    private readonly functionName: string;
    private readonly events: FunctionBaseEvent<OFunctionEvent>[];
    //
    public constructor(plugin: Hybridless, functionOptions: OFunction, functionName: string) {
        this.plugin = plugin;
        this.funcOptions = functionOptions;
        this.functionName = functionName;
        if (functionOptions.events) {
            this.events = functionOptions.events.map((rawEvent, index) => {
                return (this.parseFunction(this.plugin, this, rawEvent, index));
            });
        }
    }

    //Plugin life cycle
    public async spread(): BPromise {
        //For type of event, spread the function
        return new BPromise( async (resolve) => {
            let clusterTasks = [];
            //Spread events
            for (let event of this.events) {
                if (event && event.isEnabled()) {
                    this.plugin.logger.log(`Spreading event ${this.functionName}:${event.eventType}...`);
                    await event.spread();
                    //Check for cluster tasks
                    if (event instanceof FunctionContainerBaseEvent) {
                        const task = await (<FunctionContainerBaseEvent>event).getClusterTask();
                        //Lambda containers or any other non-task based event would not return a cluster task
                        if (task) clusterTasks.push(task);
                    }
                }
            };
            //Check for cluster creation
            if (clusterTasks.length > 0) await this._spreadCluster(clusterTasks);
            //
            resolve();
        });
    }
    public async checkDependecies(): BPromise {
        //For type of event, check function dependencies
        return new BPromise(async (resolve) => {
            for (let event of this.events) {
                if (event && event.isEnabled()) await event.checkDependecies();
            };
            resolve();
        });
    }
    public async createRequiredResources(): BPromise {
        //For type of event, check function dependencies
        return new BPromise(async (resolve) => {
            for (let event of this.events) {
                if (event && event.isEnabled()) await event.createRequiredResources();
            };
            resolve();
        });
    }
    public async build(): BPromise {
        //For type of event, compile the function
        return new BPromise(async (resolve) => {
            for (let event of this.events) {
                if (event && event.isEnabled()) {
                    this.plugin.logger.log(`Building event ${this.functionName}:${event.eventType}...`);
                    await event.build();
                }
            };
            resolve();
        });
    }
    public async push(): BPromise {
        //For type of event, spread the function
        return new BPromise(async (resolve) => {
            for (let event of this.events) {
                if (event && event.isEnabled()) {
                    this.plugin.logger.log(`Pushing event ${this.functionName}:${event.eventType}...`);
                    await event.push();
                }
            };
            resolve();
        });
    }

    //Public getters
    public getEntrypoint(optionalEvent: OFunctionEvent): string {
        //PHP function event?
        if (optionalEvent && optionalEvent['runtime'] && (optionalEvent['runtime'] == OFunctionHttpdRuntime.php5 || optionalEvent['runtime'] == OFunctionHttpdRuntime.php7)) {
            //get handler without last component (function)
            let noFuncHandler: any = (optionalEvent.handler || this.funcOptions.handler).split('/');
            noFuncHandler.splice(noFuncHandler.length - 1, 1);
            noFuncHandler = noFuncHandler.join('/');    
            return noFuncHandler;
        } else {
            //get handler without last component (function)
            let noFuncHandler: any = (optionalEvent.handler || this.funcOptions.handler).split('.');
            noFuncHandler.splice(noFuncHandler.length - 1, 1);
            noFuncHandler = noFuncHandler.join('.');
            return noFuncHandler;
        }
    }
    public getEntrypointFunction(optionalEvent: OFunctionEvent): string {
        let noFuncHandler: string = this.getEntrypoint(optionalEvent);
        //PHP function event?
        if (optionalEvent && optionalEvent['runtime'] && (optionalEvent['runtime'] == OFunctionHttpdRuntime.php5 || optionalEvent['runtime'] == OFunctionHttpdRuntime.php7)) {
            return (optionalEvent.handler || this.funcOptions.handler).replace(noFuncHandler, '');
        } else {
            return (optionalEvent.handler || this.funcOptions.handler).replace(noFuncHandler + '.', '');
        }
    }
    public getName(): string {
        return this.plugin.provider.naming.getNormalizedFunctionName(this.functionName);
    }

    //private sub logic
    private _spreadCluster(tasks): BPromise {
        return new BPromise( (resolve) => {
            //Check if needs ELB, we check against HTTPD because we can have proc. and httpd mixed in same cluster but still
            //requiring loadbalancer
            const needsELB = !!(this.events.find(e => (e instanceof FunctionHTTPDEvent)));
            //Write fargate task
            const FargateName = this.getName();
            const FargateResource = {
                clusterName: FargateName,
                disableELB: !needsELB,
                ...(this.funcOptions.ecsClusterArn && this.funcOptions.ecsClusterArn != 'null' && this.funcOptions.ecsIngressSecGroupId && this.funcOptions.ecsIngressSecGroupId != 'null' ?
                    { clusterArns: { ecsClusterArn: this.funcOptions.ecsClusterArn, ecsIngressSecGroupId: this.funcOptions.ecsIngressSecGroupId } } : { }),
                //We need to have an additional gap on the ELB timeout
                ...(this.funcOptions.timeout ? { timeout: this.funcOptions.timeout + 1 } : { timeout: Globals.HTTPD_DefaultTimeout + 1 }),
                tags: this.plugin.getDefaultTags(true),
                ...this.getVPC(true),
                //needs pulic IP to be able to retrieve ECS info -- in most of the cases
                //however when alb is disabled this param is disreguarded
                public: true, /*  */
                services: tasks,
                ...(this.funcOptions.albListenerArn && this.funcOptions.albListenerArn != 'null' ? { albListenerArn: this.funcOptions.albListenerArn } : {}),
            };
            this.plugin.appendFargateCluster(FargateName, FargateResource);
            //
            resolve();
        })
    }


    //Helpers
    private parseFunction(plugin: Hybridless, func: BaseFunction, event: OFunctionEvent, index: number): FunctionBaseEvent<OFunctionEvent> {
        if (event.eventType == OFunctionEventType.process) {
            return new FunctionProcessEvent(plugin, func, <OFunctionProcessTaskEvent>event, index);
        } else if (event.eventType == OFunctionEventType.httpd) {
            return new FunctionHTTPDEvent(plugin, func, <OFunctionHTTPDTaskEvent>event, index);
        } else if (event.eventType == OFunctionEventType.lambda) {
            return new FunctionLambdaEvent(plugin, func, <FunctionLambdaEvent>event, index);
        } else if (event.eventType == OFunctionEventType.lambdaContainer) {
            return new FunctionLambdaContainerEvent(plugin, func, <FunctionLambdaContainerEvent>event, index);
        } return null;
    }
    public getVPC(wrapped: boolean): any {
        if (this.funcOptions.vpc) {
            if ((this.funcOptions.vpc.vpcId && this.funcOptions.vpc.vpcId != 'null') || 
                (this.funcOptions.vpc.cidr && this.funcOptions.vpc.cidr != 'null')) {
                    return (wrapped ? {vpc: this.funcOptions.vpc} : {});
                }
        } return (wrapped ? {} : null);
    }
}