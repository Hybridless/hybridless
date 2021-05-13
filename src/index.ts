import { BaseFunction } from "./resources/Function";
import { OIAMServicesPrincipal, OPlugin } from "./options";
//
import Logger from "./core/Logger";
import Docker from "./core/Docker";
//
import _ = require('lodash');
import BPromise = require('bluebird');
import DepsManager from "./core/DepsManager";
import Globals from "./core/Globals";
//
const PluginOptionsSchema = require('./options.json');
//Global reference for static usage on webpack entrypoint or other references
let _globalHybridless: hybridless = null;
//
class hybridless {
    //Plugin stub
    private readonly hooks: {[key: string]: Function};
    private readonly commands: object;
    //Core 
    public readonly serverless: any;
    public readonly logger: Logger;
    public readonly docker: Docker;
    public readonly depManager: DepsManager;
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
                        lifecycleEvents: ['pack']
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
            'hybridless:predeploy:pack': () => BPromise.bind(this).then(this.finish), //7
            'hybridless:predeploy:compileCloudFormation': () => BPromise.bind(this).then(this.compileCloudFormation), //7, 8
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
            'package:compileFunctions': () => {
                return BPromise.bind(this)
                    .then(() => this.serverless.pluginManager.spawn('hybridless:predeploy')) //7, 8
            }
        };
    }

    /* Live-cycle */
    private async setup(): BPromise {
        return new BPromise( async (resolve) => {
            this.logger.log('Setting up plugin...');
            //Main ivars
            const rawOptions = (this.serverless.pluginManager.serverlessConfigFile ? this.serverless.pluginManager.serverlessConfigFile.hybridless : this.serverless.configurationInput.hybridless);
            let tmpOptions: OPlugin = await this.serverless.variables.populateObject(rawOptions);
            //Normalize events -- in case of importing files, functions come in array
            if (Array.isArray(tmpOptions.functions)) {
                const tmp = tmpOptions.functions;
                tmpOptions.functions = {}; //reset
                for (let func of tmp) tmpOptions.functions = {...tmpOptions.functions, ...func };
            }
            this.options = tmpOptions;
            //Initialize stuff
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
    private async compile(): BPromise {
        //Additional iam schema
        return new BPromise.resolve()
            .then(() => (!this.depManager.isWebpackRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('webpack:validate')))
            .then(() => (!this.depManager.isWebpackRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('webpack:compile')))
            .then(() => (!this.depManager.isWebpackRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('webpack:package')));
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
            let builds = [];
            for (let func of this.functions) builds.push(func.build());
            await BPromise.all(builds);
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
    private async finish(): BPromise {
        return new BPromise(async (resolve) => {
            await this._modifyExecutionRole();
            resolve();
        });
    }
    private async compileCloudFormation(): BPromise {
        return new BPromise.resolve()
            .then(() => (!this.depManager.isECSRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('serverless-ecs-plugin:compile')));
    }
    

    /* Public Getters */
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


    //Resources managements
    public appendResource(serviceKey: string, service: any): void {
        _.set(this.serverless, `service.resources.Resources.${serviceKey}`, service);
    }
    public appendServerlessFunction(func: any): void {
        if (!this.serverless.service.functions) this.serverless.service.functions = {};
        this.serverless.service.functions = {
            ...this.serverless.service.functions,
            ...func
        };
    }
    public appendECSCluster(clusterName: string, cluster: any): void {
        if (!this.serverless.service) this.serverless.service = {};
        if (!this.serverless.service.ecs) this.serverless.service.ecs = [];
        this.serverless.service.ecs.push(cluster);
    }
    public async loadPlugin(plugin: any): BPromise<any> {
        return await this.serverless.pluginManager.loadPlugin(plugin);
    }
    private validateExistingServerlessConfiguration(): void {
        //TODO: find better way of reissuing validation from in-memory service 
        let configClone = _.cloneDeep(this.serverless.service);
        ['serverless', 'serviceObject', 'pluginsData', 'serviceFilename', 'initialServerlessConfig', 'isDashboardMonitoringPreconfigured'].forEach((k) => delete configClone[k]);
        this.serverless.configSchemaHandler.validateConfig(configClone);
    }
    private async _modifyExecutionRole(): BPromise {
        //Modify lambda execution role
        const policy = this.serverless.service.provider.compiledCloudFormationTemplate.Resources['IamRoleLambdaExecution'];
        if (policy && this.depManager.isECSRequired()) {
            if (policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.indexOf('ecs-tasks.amazonaws.com') == -1) {
                policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.push('ecs-tasks.amazonaws.com');

            } 
        } else if (this.depManager.isECSRequired()) this.logger.error('Could not find IamRoleLambdaExecution policy for appending trust relation with ECS.');
        if (policy && this.serverless.service.provider?.iam?.servicesPrincipal) {
            for (let principal of this.serverless.service.provider?.iam?.servicesPrincipal) {
                if (policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.indexOf(principal) == -1) {
                    policy.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service.push(principal);
                }
            }
        } else if (this.serverless.service.provider?.iam?.servicesPrincipal) this.logger.error('Could not find IamRoleLambdaExecution policy for appending trust relation with additional specified services.');
        return BPromise.resolve();
    }


    /* Static Interface - Webpack */
    public static getWebpackEntries(): object {
        const entries = {};
        //for each function, add entry!
        for (let funcName of Object.keys(_globalHybridless.options.functions)) {
            const func = _globalHybridless.options.functions[funcName];
            const isNodeJS = (func.events.find((e) => (e['runtime'].toLowerCase().indexOf('node') != -1)));
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
        return {
            ...entries, 
            //include default webpack 
            ...(_globalHybridless.depManager.isWebpackRequired() ? require("serverless-webpack").lib.entries : {})
        };
    }
    public static getWebpackExternals(): object {
        return (_globalHybridless.depManager.isWebpackRequired() ? require("webpack-node-externals")() : {});
    }
    public static isWebpackLocal(): boolean {
        return (_globalHybridless.depManager.isWebpackRequired() ? require("serverless-webpack").lib.webpack.isLocal : false);
    }
}

export = hybridless;
