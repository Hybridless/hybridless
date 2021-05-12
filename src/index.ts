import { BaseFunction } from "./resources/Function";
import { OPlugin } from "./options";
//
import Logger from "./core/Logger";
import Docker from "./core/Docker";
//
import _ = require('lodash');
import BPromise = require('bluebird');
import DepsManager from "./core/DepsManager";
import Globals from "./core/Globals";
//
let _slsOptionsRef = null;
//
class Hybridless {
    //Plugin stub
    private readonly hooks: {[key: string]: Function};
    private readonly commands: object;
    //Core 
    public readonly serverless: any;
    public readonly logger: Logger;
    public readonly docker: Docker;
    public readonly depManager: DepsManager;
    public containerFunctions: boolean;
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
        this.serverless = serverless;
        this.logger = new Logger(this, 'DEBUG');
        this.docker = new Docker(this);
        this.depManager = new DepsManager(this);
        this.functions = [];
        this.containerFunctions = false;
        //Commands
        this.commands = {
            Hybridless: {
                usage: 'Hybridless TODO',
                commands: {
                    create: {
                        type: 'entrypoint',
                        lifecycleEvents: ['resources'],
                    },
                    spread: {
                        type: 'entrypoint',
                        lifecycleEvents: ['spread'],
                    },
                    build: {
                        type: 'entrypoint',
                        lifecycleEvents: ['build']
                    },
                    push: {
                        type: 'entrypoint',
                        lifecycleEvents: ['push']
                    }
                }
            }
        };
        //Hooks
        this.hooks = {
            // Cmds
            'hybridless:create:resources': () => BPromise.bind(this).then(this.createResouces),
            'hybridless:checkDependecies:checkDependecies': () => BPromise.bind(this).then(this.checkDependecies),
            'hybridless:spread:spread': () => BPromise.bind(this).then(this.spread),
            'hybridless:build:build': () => BPromise.bind(this).then(this.build),
            'hybridless:push:push': () => BPromise.bind(this).then(this.push),
            // Real hooks
            'before:package:initialize': () => {
                return BPromise.bind(this)
                    .then(this.setup) //0
                    .then(this.spread) //1
                    .then(this.checkDependecies) //2
                    .then(() => this.serverless.pluginManager.spawn('hybridless:create')) //3
            },
            'package:createDeploymentArtifacts': () => {
                return BPromise.bind(this)
                    .then(() => this.serverless.pluginManager.spawn('hybridless:build')) //4
                    .then(() => this.serverless.pluginManager.spawn('hybridless:push')) //5
            },
            'deploy:compileFunctions': () => {
                return BPromise.bind(this)
                    .then(this.compile) //6
            }
        }
    }

    /* routines */
    private async setup(): BPromise {
        return new BPromise( async (resolve) => {
            this.logger.log('Setting up plugin...');
            //Main ivars
            const rawOptions = (this.serverless.pluginManager.serverlessConfigFile ? this.serverless.pluginManager.serverlessConfigFile.hybridless : this.serverless.configurationInput.hybridless);
            let tmpOptions: any = await this.serverless.variables.populateObject(rawOptions);
            //Normalize events -- in case of importing files, functions come in array
            if (Array.isArray(tmpOptions.functions)) {
                const tmp = tmpOptions.functions;
                tmpOptions.functions = {}; //reset
                for (let func of tmp) tmpOptions.functions = {...tmpOptions.functions, ...func };
            }
            this.options = tmpOptions;
            //Initialize stuff
            _slsOptionsRef = this.options;
            this.provider = this.serverless.getProvider(Globals.PluginDefaultProvider);
            this.service = this.serverless.service;
            this.stage = (this.service.custom ? this.service.custom.stage : null);
            if (!this.stage) this.stage = (this.service.provider ? this.service.provider.stage : this.service.stage);
            this.region = this.service.provider.region;
            //
            resolve();
        });
    }
    private async spread(): BPromise {
        return new BPromise( async (resolve) => {
            this.logger.log('Spreading components...');

            //No components specified, don't process
            if (!this.options || !Object.keys(this.options).length) {
                this.logger.error('No components to be processed.');
                resolve();
                return;
            }

            //For each function
            for (let funcName of Object.keys(this.options.functions)) {
                if (this.options.functions[funcName]) {
                    this.logger.log(`Spreading function ${funcName}...`);
                    const func: BaseFunction = new BaseFunction(this, this.options.functions[funcName], `${funcName}`);
                    if (func) {
                        await func.spread();
                        this.functions.push(func);
                    } else {
                        this.logger.warn(`Skipping function ${funcName}, resource is invalid!`);
                    }
                } else {
                    this.logger.warn(`Skipping function ${funcName}, resource is invalid!`);
                }
            }
            resolve();
        });
    }
    private async checkDependecies(): BPromise {
        return new BPromise(async (resolve) => {
            //For each function
            for (let func of this.functions) await func.checkDependecies();
            //Check with manager
            await this.depManager.checkDependencies();
            //
            resolve();
        }); 
    }
    private async createResouces(): BPromise {
        return new BPromise(async (resolve) => {
            //No components specified, don't process
            if (!this.options || !Object.keys(this.options).length) {
                this.logger.error('No components to push.');
                resolve();
                return;
            }
            //For each function
            this.logger.log('Creating components required resources...');
            for (let func of this.functions) await func.createRequiredResources();
            //
            resolve();
        });
    }
    private async build(): BPromise { 
        return new BPromise( async (resolve) => {
            //No components specified, don't process
            if (!this.options || !Object.keys(this.options).length) {
                this.logger.error('No components to build.');
                resolve();
                return;
            }
            //For each function
            this.logger.log('Building components from functions...');
            for (let func of this.functions) await func.build();
            //
            resolve();
        }); 
    }
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
            for (let func of this.functions) await func.push();
            //
            resolve();
        });
    }
    private async compile(): BPromise {
        return new BPromise(async (resolve) => {
            await this._modifyExecutionRole();
            resolve();
        });
    }
    
    //Getters
    public getDefaultTags(raw?: boolean): Array<object> | string[] {
        if (raw) return this.options.tags;
        if (this.options.tags && Object.keys(this.options.tags).length > 0) {
            return Object.keys(this.options.tags).map((tagKey: string) => ({
                "Key": tagKey,
                "Value": this.options.tags[tagKey]
            }));
        } return [];
    }
    public getName(): string {
        return this.provider.naming.getNormalizedFunctionName(`${this.service.service}`.replace(/-/g,''));
    }

    //Resources managements
    public appendResource(serviceKey: string, service: any): void {
        _.set(this.serverless, `service.resources.Resources.${serviceKey}`, service);
    }
    public appendComponent(componentKey: string, component: any): void {
        _.set(this.serverless, `service.${componentKey}`, component);
    }
    public appendServerlessFunction(func: any): void {
        if (!this.serverless.service.functions) this.serverless.service.functions = {};
        this.serverless.service.functions = {
            ...this.serverless.service.functions,
            ...func
        };
    }
    public appendFargateCluster(clusterName: string, cluster: any): void {
        if (!this.serverless.service.custom) this.serverless.service.custom = {};
        if (!this.serverless.service.custom.fargate) this.serverless.service.custom.fargate = [];
        this.serverless.service.custom.fargate.push(cluster);
    }
    public async loadPlugin(plugin: any): BPromise<any> {
        return await this.serverless.pluginManager.loadPlugin(plugin);
    }
    private async _modifyExecutionRole(): BPromise {
        //Modify lambda execution role
        const policy = this.serverless.service.provider.compiledCloudFormationTemplate.Resources['IamRoleLambdaExecution'];
        if (policy && this.containerFunctions) {
            if (policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.indexOf('ecs-tasks.amazonaws.com') == -1) {
                policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.push('ecs-tasks.amazonaws.com');

            } 
        } else if (this.containerFunctions) console.error('Could not find IamRoleLambdaExecution policy for appending trust relation with ECS.');
        //v2 - Modify execution role principal (if needed)
        if (policy && this.serverless.service.provider?.iam?.servicesPrincipal) {
            for (let principal of this.serverless.service.provider?.iam?.servicesPrincipal) {
                if (policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.indexOf(principal) == -1) {
                    policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.push(principal);
                }
            }
        } else if (this.serverless.service.provider?.iam?.servicesPrincipal) console.error('Could not find IamRoleLambdaExecution policy for appending trust relation with additional specified services.');
        return BPromise.resolve();
    }

    //Helpers
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

    //webpack
    public static getWebpackEntries(): BPromise {
        const entries = {};
        //for each function, add entry!
        for (let funcName of Object.keys(_slsOptionsRef.functions)) {
            const func = _slsOptionsRef.functions[funcName];
            const isNodeJS = (func.events.find((e) => (e['runtime'].indexOf('node') != -1)));
            //Handler is defined at root level
            if (func.handler && isNodeJS) {
                //get handler without last component (function)
                let noFuncHandler: any = func.handler.split('.');
                noFuncHandler.splice(noFuncHandler.length - 1, 1);
                noFuncHandler = noFuncHandler.join('.');
                //assing
                entries[noFuncHandler] = `./${noFuncHandler}.js`;
            } else if (isNodeJS) { //handler is define at event level
                for (let event of func.events) {
                    //get handler without last component (function)
                    let noFuncHandler: any = event.handler.split('.');
                    noFuncHandler.splice(noFuncHandler.length - 1, 1);
                    noFuncHandler = noFuncHandler.join('.');
                    //assing
                    entries[noFuncHandler] = `./${noFuncHandler}.js`;
                }
            }
        }
        //
        return entries;
    }
}

export = Hybridless;
