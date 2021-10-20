import Hybridless = require("..");
import Globals from "./Globals";
//
import BPromise = require('bluebird');
import { execSync } from 'child_process';
//
export default class DepsManager {
  private requiresWebpack: boolean;
  private requiresECS: boolean;
  private requiresMvn: boolean;
  //
  private readonly plugin: Hybridless;
  //
  constructor(plugin: Hybridless) {
    this.plugin = plugin;
  }
  //
  public enableWebpack(): void { this.requiresWebpack = true; }
  public enableECSPlugin(): void { this.requiresECS = true; }
  public enableMvn(): void { this.requiresMvn = true; }
  //
  public isWebpackRequired(): boolean { return this.requiresWebpack; }
  public isECSRequired(): boolean { return this.requiresECS; }
  public isMvnRequired(): boolean { return this.requiresMvn; }
  //
  public async loadDependecies(): BPromise {
    const pluginsList = this.plugin.service.plugins;
    //Check for each requirement
    if (this.requiresWebpack && !this._isPluginInstalledServerless(pluginsList, Globals.Deps_Webpack)) {
      this.plugin.logger.info('Webpack plugin is required, enabling it!');
      await this.plugin.serverless.pluginManager.addPlugin(require(Globals.Deps_Webpack));
    }
    if (this.requiresECS && !this._isPluginInstalledServerless(pluginsList, Globals.Deps_ECS)) {
      this.plugin.logger.info('ECS plugin is required, enabling it!');
      await this.plugin.serverless.pluginManager.addPlugin(require(Globals.Deps_ECS));
    }
    return BPromise.resolve();
  }
  public async compile(): BPromise {
    // if (this.requiresWebpack) {
    //   // Since sls 2.63.0 plugin seems to be invoked without requiring it to validate/compile/package
    //   // .then(() => (!this.depManager.isWebpackRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('webpack:validate')))
    //   // .then(() => (!this.depManager.isWebpackRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('webpack:compile')))
    //   // .then(() => (!this.depManager.isWebpackRequired() ? BPromise.resolve() : this.serverless.pluginManager.spawn('webpack:package')));
    // }
    return BPromise.resolve()
            .then(() => (!this.isMvnRequired() ? BPromise.resolve() : this._compileJava()));
  }
  /*  private  */
  private _isPluginInstalledServerless(pluginsList: Array<string>, dependency: string): boolean {
    if (!pluginsList || pluginsList.indexOf(dependency) == -1) return false;
    return true;
  }
  private async _compileJava(): BPromise {
    return new BPromise(async (resolve, reject) => {
      this.plugin.logger.info('MVN is required to compile Java code, compiling...');
      const exec = await this._runCommand(Globals.Mvn_Build_Command);
      if (!exec || exec.toLowerCase().indexOf('error') == -1) {
        this.plugin.logger.debug(exec);
        resolve();
      } else reject(exec);
    });
  }
  private async _runCommand(cmd) {
    return new BPromise((resolve, reject) => {
      resolve(execSync(cmd));
    });
  }
}