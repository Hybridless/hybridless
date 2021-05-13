import { OFunction, OFunctionEvent, OVPCOptions_Shared, OVPCOptions_Dedicated, OFunctionProcessTaskEvent, OFunctionHTTPDTaskEvent, OFunctionEventType, OFunctionLambdaEvent, OFunctionLambdaContainerEvent } from "../options";
import Hybridless = require("..");
//Event types
import { FunctionProcessTaskEvent } from "./FunctionProcessTaskEvent";
import { FunctionHTTPDTaskEvent } from "./FunctionHttpdTaskEvent";
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
    public async checkDependencies(): BPromise {
        //For type of event, check function dependencies
        return new BPromise(async (resolve) => {
            for (let event of this.events) {
                if (event && event.isEnabled()) await event.checkDependencies();
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
    public getEntrypoint(event: OFunctionEvent): string {
        //PHP function event?
        if (event && event['runtime'] && event['runtime'].toLowerCase().indexOf('php') != -1) {
            //get handler without last component (function)
            let noFuncHandler: any = (event.handler || this.funcOptions.handler).split('/');
            noFuncHandler.splice(noFuncHandler.length - 1, 1);
            noFuncHandler = noFuncHandler.join('/');    
            return noFuncHandler;
        } else if (event && event['runtime'] && event['runtime'].toLowerCase().indexOf('node') != -1) { //NodeJS event
            //get handler without last component (function)
            let noFuncHandler: any = (event.handler || this.funcOptions.handler).split('.');
            noFuncHandler.splice(noFuncHandler.length - 1, 1);
            noFuncHandler = noFuncHandler.join('.');
            return noFuncHandler;
        } else {
            this.plugin.logger.error('Could not generate entrypoint for event! No runtime is specified..', event);
        }
    }
    public getEntrypointFunction(event: OFunctionEvent): string {
        let noFuncHandler: string = this.getEntrypoint(event);
        //PHP function event?
        if (event && event['runtime'] && event['runtime'].toLowerCase().indexOf('php') != -1) {
            return (event.handler || this.funcOptions.handler).replace(noFuncHandler, '');
        } else if (event && event['runtime'] && event['runtime'].toLowerCase().indexOf('node') != -1) { //NodeJS event
            return (event.handler || this.funcOptions.handler).replace(noFuncHandler + '.', '');
        } else {
            this.plugin.logger.error('Could not generate entrypoint for event! No runtime is specified..', event);
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
            const needsELB = !!(this.events.find(e => (e instanceof FunctionHTTPDTaskEvent)));
            //Write ecs task
            const ECSName = this.getName();
            const EBSResource = {
                clusterName: ECSName,
                tags: this.plugin.getDefaultTags(true),
                services: tasks,
                //Should specify custom cluster?
                ...(this.funcOptions.ecsClusterArn && this.funcOptions.ecsClusterArn != 'null' && this.funcOptions.ecsIngressSecGroupId && this.funcOptions.ecsIngressSecGroupId != 'null' ?
                    { clusterArns: { ecsClusterArn: this.funcOptions.ecsClusterArn, ecsIngressSecGroupId: this.funcOptions.ecsIngressSecGroupId } } : { }),
                //VPC
                ...this.getVPC(true),
                //needs pulic IP to be able to retrieve ECS info -- in most of the cases
                //however when alb is disabled this param is disreguarded
                public: true, /*  */
                disableELB: !needsELB,
                ...(this.funcOptions.albListenerArn && this.funcOptions.albListenerArn != 'null' ? { albListenerArn: this.funcOptions.albListenerArn } : {}),
                //We need to have an additional gap on the ALB timeout
                timeout: (this.funcOptions.timeout || Globals.HTTPD_DefaultTimeout) + (this.funcOptions.additionalALBTimeout || Globals.DefaultLoadBalancerAdditionalTimeout),
            };
            this.plugin.appendECSCluster(ECSName, EBSResource);
            //
            resolve();
        })
    }


    //Helpers
    private parseFunction(plugin: Hybridless, func: BaseFunction, event: OFunctionEvent, index: number): FunctionBaseEvent<OFunctionEvent> {
        if (event.eventType == OFunctionEventType.process) {
            return new FunctionProcessTaskEvent(plugin, func, <OFunctionProcessTaskEvent>event, index);
        } else if (event.eventType == OFunctionEventType.httpd) {
            return new FunctionHTTPDTaskEvent(plugin, func, <OFunctionHTTPDTaskEvent>event, index);
        } else if (event.eventType == OFunctionEventType.lambda) {
            return new FunctionLambdaEvent(plugin, func, <OFunctionLambdaEvent>event, index);
        } else if (event.eventType == OFunctionEventType.lambdaContainer) {
            return new FunctionLambdaContainerEvent(plugin, func, <OFunctionLambdaContainerEvent>event, index);
        } return null;
    }
    public getVPC(wrapped: boolean): any {
        if (this.funcOptions.vpc) {
            if (((this.funcOptions.vpc as OVPCOptions_Shared).vpcId && (this.funcOptions.vpc as OVPCOptions_Shared).vpcId != 'null') ||
                 ((this.funcOptions.vpc as OVPCOptions_Dedicated).cidr && (this.funcOptions.vpc as OVPCOptions_Dedicated).cidr != 'null')) {
                    return (wrapped ? {vpc: this.funcOptions.vpc} : {});
                }
        } return (wrapped ? {} : null);
    }
}