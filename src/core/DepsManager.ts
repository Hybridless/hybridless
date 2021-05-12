import Hybridless = require("..");
import Globals from "./Globals";
//
import BPromise = require('bluebird');
//
export default class DepsManager {
    private requiresWebpack: boolean;
    private requiresFargate: boolean;
    // private requiresOffline: boolean;
    // private requiresDynamoLocal: boolean;
    // private requiresCFVars: boolean;
    // private requiresIAMRoles: boolean;
    //
    private readonly plugin: Hybridless;
    //
    constructor(plugin: Hybridless) {
        this.plugin = plugin;
    }
    // //
    public enableWebpack(): void { this.requiresWebpack = true; }
    public enableECSPlugin(): void { this.requiresFargate = true; }
    // public enableOffline(): void { this.requiresOffline = true; }
    // public enableDynamoLocal(): void { this.requiresDynamoLocal = true; }
    // public enableCFVars(): void { this.requiresCFVars = true; }
    // public enableIAMRoles(): void { this.requiresIAMRoles = true; }
    //
    public async checkDependencies(): BPromise {
        //TODO: implement dependencies check
        const failuresJSON = [], failuresSLS = [];
        //Load app JSON and serverless plugins list
        const appJSON = await this.plugin.serverless.utils.readFile(this.plugin.serverless.config.servicePath + '/package.json');
        const pluginsList = this.plugin.service.plugins;

        //Check for each requirement
        if (this.requiresWebpack && !this._pluginInstalledJSON(appJSON, Globals.Deps_Webpack)) failuresJSON.push(Globals.Deps_Webpack);
        if (this.requiresWebpack && !this._pluginInstalledServerless(pluginsList, Globals.Deps_Webpack)) failuresSLS.push(Globals.Deps_Webpack);
        if (this.requiresFargate && !this._pluginInstalledJSON(appJSON, Globals.Deps_ECS)) failuresJSON.push(Globals.Deps_ECS);
        if (this.requiresFargate && !this._pluginInstalledServerless(pluginsList, Globals.Deps_ECS)) failuresSLS.push(Globals.Deps_ECS);
        // if (this.requiresOffline && !this._pluginInstalled(appJSON, pluginsList, Globals.Deps_Offline)) failures.push(Globals.Deps_Offline);
        // if (this.requiresDynamoLocal && !this._pluginInstalled(appJSON, pluginsList, Globals.Deps_DynamoLocal)) failures.push(Globals.Deps_DynamoLocal);
        // if (this.requiresCFVars && !this._pluginInstalled(appJSON, pluginsList, Globals.Deps_CFVars)) failures.push(Globals.Deps_CFVars);
        // if (this.requiresIAMRoles && !this._pluginInstalled(appJSON, pluginsList, Globals.Deps_IAMRoles)) failures.push(Globals.Deps_IAMRoles);

        //Print and throw if need
        this._processCheckResults(failuresJSON, failuresSLS);
    }
    private _pluginInstalledJSON(appJSON: any, dependency: string): boolean {
        if (!appJSON.devDependencies || !appJSON.devDependencies[dependency]) return false;
        return true;
    }
    private _pluginInstalledServerless(pluginsList: Array<string>, dependency: string): boolean {
        if (!pluginsList || pluginsList.indexOf(dependency) == -1) return false;
        return true;
    }
    private _processCheckResults(jsonFailures: string[], slsFailures: string[]) {
        //Print
        for (let jsonFailure of jsonFailures) this.plugin.logger.error(`Plugin ${jsonFailure} is not present on package.json:devDependecies, this is a requirement for current configuration!`);
        for (let slsFailure of slsFailures) this.plugin.logger.error(`Plugin ${slsFailure} is not present on serverless.yml:plugins, this is a requirement for current configuration!`);
        //Throw
        if (jsonFailures.length || slsFailures.length) {
            throw new Error(`Can't continue due errors above, please, install the mentioned plugins..`);
        }
    }
}