import Hybridless = require("..");
import Globals from "./Globals";
//
import BPromise = require('bluebird');
//
export default class DepsManager {
    private requiresWebpack: boolean;
    private requiresECS: boolean;
    //
    private readonly plugin: Hybridless;
    //
    constructor(plugin: Hybridless) {
        this.plugin = plugin;
    }
    //
    public enableWebpack(): void { this.requiresWebpack = true; }
    public enableECSPlugin(): void { this.requiresECS = true; }
    //
    public isWebpackRequired(): boolean { return this.requiresWebpack; }
    public isECSRequired(): boolean { return this.requiresECS; }
    //
    public async loadDependecies(): BPromise {
        const pluginsList = this.plugin.service.plugins;
        //Check for each requirement
        if (this.requiresWebpack && !this._pluginInstalledServerless(pluginsList, Globals.Deps_Webpack)) {
            console.info('Webpack plugin is required, enabling it!');
            await this.plugin.serverless.pluginManager.addPlugin(require(Globals.Deps_Webpack));
        }
        if (this.requiresECS && !this._pluginInstalledServerless(pluginsList, Globals.Deps_ECS)) {
            console.info('ECS plugin is required, enabling it!');
            await this.plugin.serverless.pluginManager.addPlugin(require(Globals.Deps_ECS));
        }
        return BPromise.resolve();
    }
    private _pluginInstalledServerless(pluginsList: Array<string>, dependency: string): boolean {
        if (!pluginsList || pluginsList.indexOf(dependency) == -1) return false;
        return true;
    }
}