import { OFunction, OFunctionEvent, OVPCOptions_Shared, OVPCOptions_Dedicated, OFunctionProcessTaskEvent, OFunctionHTTPDTaskEvent, OFunctionEventType, OFunctionLambdaEvent, OFunctionLambdaContainerEvent, OFunctionScheduledTaskEvent } from "../options";
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
import { FunctionScheduledTaskEvent } from "./FunctionScheduledTaskEvent";

export class BaseFunction {
  public readonly funcOptions: OFunction;
  private readonly plugin: Hybridless;
  private ecsIsEnabled: boolean;
  private readonly functionName: string;
  private readonly events: FunctionBaseEvent<OFunctionEvent>[];
  //
  public constructor(plugin: Hybridless, functionOptions: OFunction, functionName: string) {
    this.plugin = plugin;
    this.funcOptions = functionOptions;
    this.functionName = functionName;
    this.ecsIsEnabled = false;

    if (functionOptions.events) {
      this.events = functionOptions.events.map((rawEvent, index) => {
        return (this.parseFunction(this.plugin, this, rawEvent, index));
      });
    }
  }

  //Plugin life cycle
  //spread functions, cluster tasks and clusters
  public async spread(): BPromise {
    //For type of event, spread the function
    return new BPromise(async (resolve) => {
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
      if (clusterTasks.length > 0) {
        this.ecsIsEnabled = true;
        await this._spreadCluster(clusterTasks);
      }
      //
      resolve();
    });
  }
  //check what deps. need to be enabled
  public async checkDependencies(): BPromise {
    //For type of event, check function dependencies
    return new BPromise(async (resolve) => {
      for (let event of this.events) {
        if (event && event.isEnabled()) await event.checkDependencies();
      };
      resolve();
    });
  }
  //create event extra required resources (ECR for example)
  public async createRequiredResources(): BPromise {
    //For type of event, check function dependencies
    return new BPromise(async (resolve) => {
      for (let event of this.events) {
        if (event && event.isEnabled()) await event.createRequiredResources();
      };
      resolve();
    });
  }
  //build events (images)
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
  //push events (images)
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
  //cleanup events
  public async cleanup(): BPromise {
    //For type of event, cleanup the function
    return new BPromise(async (resolve) => {
      for (let event of this.events) {
        if (event && event.isEnabled()) {
          this.plugin.logger.log(`Cleaning up ${this.functionName}:${event.eventType}...`);
          await event.cleanup();
        }
      };
      resolve();
    });
  }

  //Public getters
  public getEntrypoint(event: OFunctionEvent): string {
    //PHP function event?
    if (event && event.runtime && event.runtime.toLowerCase().indexOf('php') != -1) {
      //get handler without last component (function)
      let noFuncHandler: any = (event.handler || this.funcOptions.handler).split('/');
      noFuncHandler.splice(noFuncHandler.length - 1, 1);
      noFuncHandler = noFuncHandler.join('/');
      return noFuncHandler;
    } else if (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1) { //NodeJS event
      //get handler without last component (function)
      let noFuncHandler: any = (event.handler || this.funcOptions.handler).split('.');
      noFuncHandler.splice(noFuncHandler.length - 1, 1);
      noFuncHandler = noFuncHandler.join('.');
      return noFuncHandler;
    } else if (event && event.runtime && event.runtime.toLowerCase().indexOf('java') != -1) { //Java event
      //get handler without last component (function)
      let noFuncHandler: any = (event.handler || this.funcOptions.handler).split('::');
      if (noFuncHandler.length > 1)noFuncHandler.splice(noFuncHandler.length - 1, 1);
      noFuncHandler = noFuncHandler.join('::');
      return noFuncHandler;
    } else {
      this.plugin.logger.error('Could not generate entrypoint for event! No runtime is specified..', event);
    }
  }
  public getEntrypointFunction(event: OFunctionEvent): string {
    let noFuncHandler: string = this.getEntrypoint(event);
    //PHP function event?
    if (event && event.runtime && event.runtime.toLowerCase().indexOf('php') != -1) {
      return (event.handler || this.funcOptions.handler).replace(noFuncHandler, '');
    } else if (event && event.runtime && event.runtime.toLowerCase().indexOf('node') != -1) { //NodeJS event
      return (event.handler || this.funcOptions.handler).replace(noFuncHandler, '').replace('.', '');
    } else if (event && event.runtime && event.runtime.toLowerCase().indexOf('java') != -1) { //Java event
      return (event.handler || this.funcOptions.handler).replace(noFuncHandler, '').replace('::', '');
    } else {
      this.plugin.logger.error('Could not generate entrypoint for event! No runtime is specified..', event);
    }
  }
  public getName(): string {
    return this.plugin.provider.naming.getNormalizedFunctionName(this.functionName.replace(/-/g, ''));
  }

  //private sub logic
  private _spreadCluster(tasks): BPromise {
    return new BPromise((resolve) => {
      //Check if needs ALB, we check against HTTPD because we can have proc. and httpd mixed in same cluster but still
      //requiring loadbalancer
      const needsALB = !!(this.events.find(e => (e instanceof FunctionHTTPDTaskEvent)));
      //Write ecs task
      const ECSName = this.getName();
      const EBSResource = {
        clusterName: ECSName,
        tags: this.plugin.getDefaultTags(true),
        services: tasks,
        ...(this.funcOptions.enableContainerInsights ? { enableContainerInsights: true } : {}),
        //Should specify custom cluster?
        ...(this.funcOptions.ecsClusterArn && this.funcOptions.ecsClusterArn != 'null' && this.funcOptions.ecsIngressSecGroupId && this.funcOptions.ecsIngressSecGroupId != 'null' ?
          { clusterArns: { ecsClusterArn: this.funcOptions.ecsClusterArn, ecsIngressSecGroupId: this.funcOptions.ecsIngressSecGroupId } } : {}),
        //VPC
        ...this.getVPC(true, false),
        albPrivate: !!this.funcOptions.albIsPrivate,
        albDisabled: !needsALB,
        ...(this.funcOptions.albListenerArn && this.funcOptions.albListenerArn != 'null' ? { albListenerArn: this.funcOptions.albListenerArn } : {}),
        //We need to have an additional gap on the ALB timeout
        timeout: (this.funcOptions.timeout || Globals.HTTPD_DefaultTimeout) + (this.funcOptions.albAdditionalTimeout || Globals.DefaultLoadBalancerAdditionalTimeout),
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
    } else if (event.eventType == OFunctionEventType.scheduledTask) {
      return new FunctionScheduledTaskEvent(plugin, func, <OFunctionScheduledTaskEvent>event, index);
    } return null;
  }
  public getVPC(wrapped: boolean, isLambda: boolean): any {
    if (this.funcOptions.vpc) {
      if (((this.funcOptions.vpc as OVPCOptions_Shared).vpcId && (this.funcOptions.vpc as OVPCOptions_Shared).vpcId != 'null') ||
        ((this.funcOptions.vpc as OVPCOptions_Dedicated).cidr && (this.funcOptions.vpc as OVPCOptions_Dedicated).cidr != 'null')) {
        //If auto creating VPC (when cidr is specified), and is a lambda, return the wrapped ecs plugin created VPC
        if (isLambda && (this.funcOptions.vpc as OVPCOptions_Dedicated).cidr) return {
          vpc: {
            securityGroupIds: [{ Ref: `${this.plugin.getName()}${this.getName()}ContainerSecGroup${this.plugin.stage}` }],
            subnetIds: (this.funcOptions.vpc as OVPCOptions_Dedicated).subnets.map((v, i) => ({ Ref: `SubnetName${this.plugin.stage}${i}` }))
          }
        }
        else if (isLambda) {
          return (wrapped ? { vpc: { ...this.funcOptions.vpc, vpcId: undefined /* sls dont like vpcId*/ } } : {});
        } else {
          return (wrapped ? { vpc: this.funcOptions.vpc } : {});
        }
      }
    } return (wrapped ? {} : null);
  }
}