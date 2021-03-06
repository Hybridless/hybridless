import { BaseFunction } from "./resources/Function";
import { FunctionBaseEvent } from "./resources/BaseEvents/FunctionBaseEvent";
import { FunctionContainerBaseEvent } from "./resources/BaseEvents/FunctionContainerBaseEvent";
import { OPlugin } from "./options";
//
import Logger from "./core/Logger";
import Docker from "./core/Docker";
//
import _ = require('lodash');
import BPromise = require('bluebird');
import DepsManager from "./core/DepsManager";
import Globals from "./core/Globals";
import { DefaultDeserializer } from "v8";


//
const PluginOptionsSchema = require('./options.json');
//Global reference for static usage on webpack entrypoint or other references
let _globalHybridless: hybridless = null;

/* Hybridless */
class hybridless {
  //Plugin stub
  private readonly hooks: { [key: string]: Function };
  private readonly commands: object;
  //Core 
  public readonly serverless: any;
  public readonly logger: Logger;
  public readonly docker: Docker;
  public readonly depManager: DepsManager;
  public readonly configurationVariablesSources: any;
  //Resources
  public functions: BaseFunction[];
  //Aux
  public service: any; //serverless service
  public provider: any;
  //public rawService: any; //serverless.yml read service
  public stage: string; //stage
  public region: string; //default region
  public options: OPlugin; //options
  // 
  constructor(serverless: any, options: any) {
    _globalHybridless = this;
    this.serverless = serverless;
    this.logger = new Logger(this, 'DEBUG');
    this.docker = new Docker(this);
    this.depManager = new DepsManager(this);
    this.functions = [];
    //Schema
    this.serverless.configSchemaHandler.defineTopLevelProperty('hybridless', PluginOptionsSchema);
    //Env resolution
    this.configurationVariablesSources = this.getPluginVariablesResolution();
    //Commands
    this.commands = {
      hybridless: {
        usage: 'Hybridless TODO',
        commands: {
          create: {
            type: 'entrypoint',
            lifecycleEvents: ['setup', 'spread', 'checkDependencies', 'createResources'],
          },
          prebuild: {
            type: 'entrypoint',
            lifecycleEvents: ['compile'],
          },
          build: {
            type: 'entrypoint',
            lifecycleEvents: ['build']
          },
          push: {
            type: 'entrypoint',
            lifecycleEvents: ['push']
          },
          predeploy: {
            type: 'entrypoint',
            lifecycleEvents: ['compileCloudFormation', 'pack']
          },
          cleanup: {
            type: 'entrypoint',
            lifecycleEvents: ['cleanupContainers']
          }
        }
      }
    };
    //Hooks
    this.hooks = {
      // Cmds
      'hybridless:create:setup': () => BPromise.bind(this).then(this.setup), //0
      'hybridless:create:spread': () => BPromise.bind(this).then(this.spread), //1
      'hybridless:create:checkDependencies': () => BPromise.bind(this).then(this.checkDependencies), //2
      'hybridless:create:createResources': () => BPromise.bind(this).then(this.createResouces), //3
      'hybridless:prebuild:compile': () => BPromise.bind(this).then(this.compile), //4
      'hybridless:build:build': () => BPromise.bind(this).then(this.build), //5
      'hybridless:push:push': () => BPromise.bind(this).then(this.push), //6
      'hybridless:predeploy:compileCloudFormation': () => BPromise.bind(this).then(this.compileCloudFormation), //7
      'hybridless:predeploy:pack': () => BPromise.bind(this).then(this.modifyExecutionRole), //8
      'hybridless:cleanup:cleanupContainers': () => BPromise.bind(this).then(this.cleanupContainers), //9
      // Real hooks
      'before:package:initialize': () => {
        return BPromise.bind(this)
          .then(() => this.serverless.pluginManager.spawn('hybridless:create')) //0, 1, 2, 3
      },
      'before:package:createDeploymentArtifacts': () => {
        return BPromise.bind(this)
          .then(() => this.serverless.pluginManager.spawn('hybridless:prebuild')) //4
      },
      'package:createDeploymentArtifacts': () => {
        return BPromise.bind(this)
          .then(() => this.serverless.pluginManager.spawn('hybridless:build')) //5
          .then(() => this.serverless.pluginManager.spawn('hybridless:push')) //6
      },
      // sls v2
      'deploy:compileFunctions': () => {
        return BPromise.bind(this)
          .then(() => this.serverless.pluginManager.spawn('hybridless:predeploy')) //7, 8
      },
      // sls v3
      'package:compileFunctions': () => {
        return BPromise.bind(this)
          .then(() => this.serverless.pluginManager.spawn('hybridless:predeploy')) //7, 8
      },
      'aws:deploy:finalize:cleanup': () => {
        return BPromise.bind(this)
          .then(() => this.serverless.pluginManager.spawn('hybridless:cleanup')) //Optional 9
      }
    };
  }


  /* Life-cycle */
  //setup plugin
  private async setup(): BPromise {
    return new BPromise(async (resolve) => {
      //Address `configurationVariablesSources` use case where setup is called manually before actual serverless
      //initialization for resolving some configs. We allowe refresh since initial manual call does not resolve
      //function configs that use ssm, or any other async resolver.
      if (!this.options) this.logger.log('Setting up plugin...');
      else this.logger.log('Refreshing plugin options...');
      //Main ivars
      const rawOptions = (this.serverless.pluginManager.serverlessConfigFile ? this.serverless.pluginManager.serverlessConfigFile.hybridless : this.serverless.configurationInput.hybridless);
      // ### Since sls@v3, we don't need to ask for variable resolve
      let tmpOptions: OPlugin = (this.serverless.variables.populateObject ? await this.serverless.variables.populateObject(rawOptions) : rawOptions);
      tmpOptions = Object.assign({}, tmpOptions); //copy
      //Normalize events -- in case of importing files, functions come in array
      if (Array.isArray(tmpOptions.functions)) {
        const tmp = tmpOptions.functions;
        tmpOptions.functions = {}; //reset
        for (let func of tmp) tmpOptions.functions = { ...tmpOptions.functions, ...func };
      }
      this.options = tmpOptions;
      //Initialize stuff
      this.provider = this.serverless.getProvider(Globals.PluginDefaultProvider);
      this.service = this.serverless.service;
      this.stage = (this.service.custom ? this.service.custom.stage : null);
      if (!this.stage) this.stage = (this.service.provider ? this.service.provider.stage : this.service.stage);
      this.region = this.service.provider.region;

      //Initialize functions
      for (let funcName of Object.keys(this.options.functions)) {
        const found = this.functions.find((func: BaseFunction) => func.getName(true) == funcName);
        if (this.options.functions[funcName]) {
          if (found) found.funcOptions = this.options.functions[funcName];
          else {
            const func: BaseFunction = new BaseFunction(this, this.options.functions[funcName], `${funcName}`);
            if (func) this.functions.push(func);
            else this.logger.warn(`Skipping function ${funcName}, resource is invalid!`);
          }
        } else this.logger.warn(`Skipping function ${funcName}, resource is invalid!`);
      }
      //
      resolve();
    });
  }
  //spread functions, cluster, tasks -- propagates to functions
  private async spread(): BPromise {
    return new BPromise(async (resolve) => {
      this.logger.log('Spreading components...');
      //No components specified, don't process
      if (!this.options || !Object.keys(this.options).length) {
        this.logger.error('No components to be processed.');
        resolve();
        return;
      }
      //For each function
      for (let func of this.functions) await func.spread();
      //
      resolve();
    });
  }
  //Check dependencies, install and validate spreaded configuration -- propagates to functions
  private async checkDependencies(): BPromise {
    return new BPromise(async (resolve) => {
      //For each function
      for (let func of this.functions) await func.checkDependencies();
      //Check with manager
      await this.depManager.loadDependecies();
      //Validate schema
      this.validateExistingServerlessConfiguration();
      //
      resolve();
    });
  }
  //create extra resources (ECR, policies) -- propagates to functions
  private async createResouces(): BPromise {
    return new BPromise(async (resolve) => {
      //No components specified, don't process
      if (!this.options || !Object.keys(this.options).length) {
        this.logger.error('No components to push.');
        resolve();
        return;
      }
      //For each function
      await new BPromise.all(this.functions.map((func) => {
        return func.createRequiredResources();
      }));
      //
      resolve();
    });
  }
  //compile code
  private async compile(): BPromise {
    return new BPromise(async (resolve) => {
      await this.depManager.compile();
      resolve();
    });
  }
  //build images -- propagates to functions
  private async build(): BPromise {
    return new BPromise(async (resolve) => {
      //No components specified, don't process
      if (!this.options || !Object.keys(this.options).length) {
        this.logger.error('No components to build.');
        resolve();
        return;
      }
      //For each function
      this.logger.log('Building components from functions...');
      await new BPromise.all(this.functions.map((func) => {
        return func.build();
      }));
      //
      resolve();
    });
  }
  //retag and push images -- propagates to functions
  private async push(): BPromise {
    return new BPromise(async (resolve) => {
      //No components specified, don't process
      if (!this.options || !Object.keys(this.options).length) {
        this.logger.error('No components to push.');
        resolve();
        return;
      }
      //For each function
      this.logger.log('Pushing components from functions...');
      await new BPromise.all(this.functions.map((func) => {
        return func.push();
      }));
      //
      resolve();
    });
  }
  //modify execution role (add ECS and additional principals)
  private async modifyExecutionRole(): BPromise {
    return new BPromise(async (resolve) => {
      await this._modifyExecutionRole();
      resolve();
    });
  }
  //compile cloud formation (ecs)
  private async compileCloudFormation(): BPromise {
    return new BPromise.resolve()
      .then(() => (!this.depManager.isECSRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('serverless-ecs-plugin:compile')));
  }
  //Cleanup old containers from registry
  private async cleanupContainers(): BPromise {
    return new BPromise(async (resolve) => {
      //For each function
      this.logger.log('Cleaning up functions...');
      for (let func of this.functions) await func.cleanup();
      //
      resolve();
    });
  }


  /* Public Getters */
  public getDefaultTags(raw?: boolean): Array<object> | string[] | object {
    if (raw) return this.options.tags;
    if (this.options.tags && Object.keys(this.options.tags).length > 0) {
      return Object.keys(this.options.tags).map((tagKey: string) => ({
        "Key": tagKey,
        "Value": this.options.tags[tagKey]
      }));
    } return [];
  }
  //get service name
  public getName(): string {
    return this.provider.naming.getNormalizedFunctionName(`${this.service.service}`.replace(/-/g, ''));
  }
  public async getAccountID(): BPromise {
    const acc = await this.provider.getAccountInfo();
    if (acc && acc.accountId) return acc.accountId;
    return null;
  }
  public getEnvironmentIvars(): object {
    // return this.serverless.
    if (this.service.provider && this.service.provider.environment) {
      let copy = JSON.parse(JSON.stringify(this.service.provider.environment));
      for (let key of Object.keys(copy)) {
        if (!copy[key]) delete copy[key];
      } return copy;
    } return {};
  }


  /* Resources Management */
  public appendResource(serviceKey: string, service: any): void {
    _.set(this.serverless, `service.resources.Resources.${serviceKey}`, service);
  }
  public appendServerlessFunction(func: any): void {
    if (!this.serverless.service.functions) this.serverless.service.functions = {};
    //Some magic happens here - concatenate existing function events to avoid function overlap but still deal with events
    Object.keys(func).forEach((key) => {
      func = { ...func, [key]: {
        ...func[key],
        ...((this.serverless.service?.functions?.[key]?.events || func[key]?.events) ? {
          events: (func[key]?.events || []).concat(this.serverless.service?.functions?.[key]?.events || [])
        } : {})
      }
    }});
    //
    this.serverless.service.functions = { ...this.serverless.service.functions, ...func };
  }
  // public appendOutput(key: string, output: any): void {
  //   _.set(this.serverless, `service.resources.Outputs.${key}`, output);
  // }
  public appendECSCluster(clusterName: string, cluster: any): void {
    if (!this.serverless.service) this.serverless.service = {};
    if (!this.serverless.service.ecs) this.serverless.service.ecs = [];
    this.serverless.service.ecs.push(cluster);
  }
  private async _modifyExecutionRole(): BPromise {
    //Modify lambda execution role
    const policy = this.serverless.service.provider.compiledCloudFormationTemplate.Resources['IamRoleLambdaExecution'];
    if (policy && (this.depManager.isECSRequired() || this.depManager.enableECSRolePermission())) {
      if (policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.indexOf('ecs-tasks.amazonaws.com') == -1) {
        policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.push('ecs-tasks.amazonaws.com');

      }
    } else if (this.depManager.isECSRequired() || this.depManager.enableECSRolePermission()) this.logger.warn('Could not find IamRoleLambdaExecution policy for appending trust relation with ECS. You probably dont have any lambda function and the role is not being created.');
    if (policy && this.serverless.service.provider?.iam?.servicesPrincipal) {
      for (let principal of this.serverless.service.provider?.iam?.servicesPrincipal) {
        if (policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.indexOf(principal) == -1) {
          policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.push(principal);
        }
      }
    } else if (this.serverless.service.provider?.iam?.servicesPrincipal) this.logger.warn('Could not find IamRoleLambdaExecution policy for appending trust relation with additional specified services. You probably dont have any lambda function and the role is not being created.');
    return BPromise.resolve();
  }

  /* Plugin Helper */
  private validateExistingServerlessConfiguration(): void {
    //TODO: find better way of reissuing validation from in-memory service 
    let configClone = _.cloneDeep(this.serverless.service);
    ['serverless', 'serviceObject', 'pluginsData', 'serviceFilename', 'initialServerlessConfig', 'isDashboardMonitoringPreconfigured'].forEach((k) => delete configClone[k]);
    this.serverless.configSchemaHandler.validateConfig(configClone);
  }

  /* Plugin environment ivars resolutions */
  private getPluginVariablesResolution(): any {
    const pluginRef: hybridless = this;
    return {
      hybridless: {
        async resolve({ /* resolveVariable, options, */ address }) {
          //Issue plugin initialization call to guarantee we have enough to generate
          //resolution of: resolveContainerAddress. Maybe future implementation might 
          //require another approach.
          await pluginRef.setup();
          //Check for resolveContainerAddress only (for now)
          if (address.indexOf('resolveContainerAddress') != 0) return "Hybridless function is not supported.";
          const params = address.split(':');
          params.shift();
          if (!params[0]) return "Function name not specified on hybridless:resolveContainerAddress environment resolution.";
          //Check for existing function
          const func: BaseFunction = pluginRef.functions.find((func: BaseFunction) => func.getName(true) == params[0]);
          if (!func) return "Specified function name not specified on hybridless:resolveContainerAddress environment resolution.";
          //Check for event at index or any first occurence of container based event
          if (params[1] != undefined) {
            const funcEvent: FunctionBaseEvent<any> = func.getEventAtIndex(params[1]);
            if (funcEvent && funcEvent['getContainerImageURL']) {
              const imageURL = await (<(FunctionContainerBaseEvent)>funcEvent).getContainerImageURL();
              return { value: imageURL };
            }
          } else {
            for (let i = 0; i < func.getEventsCount(); i++) {
              const funcEvent: FunctionBaseEvent<any> = func.getEventAtIndex(i);
              if (funcEvent && funcEvent['getContainerImageURL']) {
                const imageURL = await (<(FunctionContainerBaseEvent)>funcEvent).getContainerImageURL();
                return { value: imageURL };
              }
            }
          }
          //unresolved
          return "hybridless:resolveContainerAddress environment resolution unresolved. " + address;
        },
      },
    };
  }


  /* Static Interface - Webpack */
  public static getWebpackEntries(): object {
    const entries = {};
    //for each function, add entry!
    for (let funcName of Object.keys(_globalHybridless.options.functions)) {
      const func = _globalHybridless.options.functions[funcName];
      const isNodeJS = (func.events.find((e) => (e.runtime.toLowerCase().indexOf('node') != -1)));
      //Handler is defined at root level
      if (func.handler && isNodeJS) {
        //get handler without last component (function)
        let noFuncHandler: any = func.handler.split('.');
        noFuncHandler.splice(noFuncHandler.length - 1, 1);
        noFuncHandler = noFuncHandler.join('.');
        //assing
        entries[noFuncHandler] = `./${noFuncHandler}.js`;
      } 
      if (isNodeJS) { //handlers is defined at event level
        for (let event of (func.events || [])) {
          if (!event.handler) continue;
          //get handler without last component (function)
          let noFuncHandler: any = event.handler.split('.');
          noFuncHandler.splice(noFuncHandler.length - 1, 1);
          noFuncHandler = noFuncHandler.join('.');
          //assing
          entries[noFuncHandler] = `./${noFuncHandler}.js`;
        }
      }
    }
    return {
      ...entries,
      //include default webpack 
      ...(_globalHybridless.depManager.isWebpackRequired() ? require(Globals.Deps_Webpack).lib.entries : {})
    };
  }
  public static getWebpackExternals(): object {
    return (_globalHybridless.depManager.isWebpackRequired() ? require("webpack-node-externals")() : {});
  }
  public static isWebpackLocal(): boolean {
    return (_globalHybridless.depManager.isWebpackRequired() ? require(Globals.Deps_Webpack).lib.webpack.isLocal : false);
  }
}

export = hybridless;
