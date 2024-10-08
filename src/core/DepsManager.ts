import Hybridless = require("..");
import Globals from "./Globals";
//
import BPromise = require('bluebird');
import util = require('util');
import child = require('child_process');
const executor = util.promisify(child.exec);
//
export default class DepsManager {
  private requiresWebpack: boolean;
  private requiresECSRolePermission: boolean;
  private requiresECS: boolean;
  private requiresMvn: boolean;
  private requiresGo: boolean;
  private requiresLogsRetention: boolean;
  private requiresProvisionedConcurrencyAutoscaling: boolean;
  //
  private readonly plugin: Hybridless;
  //
  constructor(plugin: Hybridless) {
    this.plugin = plugin;
  }
  //
  public enableLogsRetention(): void { this.requiresLogsRetention = true; }
  public enableWebpack(): void { this.requiresWebpack = true; }
  public enableECSPlugin(): void { this.requiresECS = true; }
  public enableECSRolePermission(): void { this.requiresECSRolePermission = true; }
  public enableProvisionedConcurrencyAutoscaling(): void { this.requiresProvisionedConcurrencyAutoscaling = true; }
  
  public enableMvn(): void { this.requiresMvn = true; }
  public enableGo(): void { this.requiresGo = true; }
  //
  public isLogsRetentionRequired(): boolean { return this.requiresWebpack; }
  public isWebpackRequired(): boolean { return this.requiresWebpack; }
  public isECSRolePermissionRequired(): boolean { return this.requiresECSRolePermission; }
  public isProvisionedConcurrencyAutoscaling(): boolean { return this.requiresProvisionedConcurrencyAutoscaling; }
  
  public isECSRequired(): boolean { return this.requiresECS; }
  public isMvnRequired(): boolean { return this.requiresMvn; }
  public isGoRequired(): boolean { return this.requiresGo; }
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
    if (this.requiresLogsRetention && !this._isPluginInstalledServerless(pluginsList, Globals.Deps_LambdaLogsRetention)) {
      this.plugin.logger.info('Lambda logs retention plugin is required, enabling it!');
      await this.plugin.serverless.pluginManager.addPlugin(require(Globals.Deps_LambdaLogsRetention));
    }
    if (this.requiresProvisionedConcurrencyAutoscaling && !this._isPluginInstalledServerless(pluginsList, Globals.Deps_LambdaProvisionedConcurrencyAutoscaling)) {
      this.plugin.logger.info('Lambda provisioned concurrency autoscaling plugin is required, enabling it!');
      await this.plugin.serverless.pluginManager.addPlugin(require(Globals.Deps_LambdaProvisionedConcurrencyAutoscaling));
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
    if (this.isMvnRequired()) return BPromise.resolve().then(() => this._compileJava());
    if (this.isGoRequired()) return BPromise.resolve().then(() => this._compileGo());
    return BPromise.resolve();
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
      if (exec && exec.stderr && exec.stderr.toLowerCase().indexOf('error')) reject(exec.stderr);
      else {
        // if (exec && exec.stdout) this.plugin.logger.debug(exec.stdout); -- Maven output seems huge enough to desconsider it and just output on errors
        resolve();
      }
    });
  }
  private async _compileGo(): BPromise {
    return new BPromise(async (resolve, reject) => {
      this.plugin.logger.info('Go is required to compile GoLang code, compiling...');
      const exec = await this._runCommand(Globals.Go_Build_Command);
      if (exec && exec.stderr && exec.stderr.toLowerCase().indexOf('error')) reject(exec.stderr);
      else {
        // if (exec && exec.stdout) this.plugin.logger.debug(exec.stdout); -- Maven output seems huge enough to desconsider it and just output on errors
        resolve();
      }
    });
  }
  private async _runCommand(command, params = []): BPromise {
    return new BPromise(async (resolve, reject) => {
      if (!params) params = [];
      let formattedParams = params.join(' ');
      try {
        //@ts-ignore
        const resp = await executor(command + ' ' + formattedParams, { maxBuffer: 1024 * 10000 });
        resolve(resp);
      } catch (err) {
        this.plugin.logger.error('Error while running command', err.stdout.toString());
        reject(err);
      }
    });
  }
}