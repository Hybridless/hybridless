import { FunctionBaseEvent } from "./FunctionBaseEvent"; //base class
//
import Hybridless = require("../..");
import { BaseFunction } from "../Function";
import { OFunctionEvent, OFunctionEventType } from "../../options";
//
import BPromise = require('bluebird');
import util = require('util');
import child = require('child_process');
import { DockerFiles } from "../../core/Globals";
//
const executor = util.promisify(child.exec);
//
export class FunctionContainerBaseEvent extends FunctionBaseEvent<OFunctionEvent> {
  private readonly currentTag: string;
  private readonly unifyEventsContainer: boolean;
  public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionEvent, index: number, unifyEventsContainer?: boolean) {
    super(plugin, func, event, index);
    this.unifyEventsContainer = unifyEventsContainer;
    this.currentTag = Date.now() + '';
  }

  //Plugin function lifecycle
  public async spread(): BPromise { return BPromise.resolve(); }
  public async checkDependencies(): BPromise {
    return new BPromise(async (resolve, reject) => {
      if (this.event.runtime && this.event.runtime.toLowerCase().indexOf('java') != -1) this.plugin.depManager.enableMvn();
      if (this.event.runtime && this.event.runtime.toLowerCase().indexOf('node') != -1 && !this.plugin.options.disableWebpack) this.plugin.depManager.enableWebpack();
      if (this.event.eventType != OFunctionEventType.lambda && this.event.eventType != OFunctionEventType.lambdaContainer) {
        this.plugin.depManager.enableECSPlugin();
      }
      if (this.event.eventType != OFunctionEventType.job) {
        this.plugin.depManager.enableECSRolePermission();
      }
      resolve();
    });
  }
  public async createRequiredResources(): BPromise {
    // Check for unified build
    if (this.unifyEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    const ECRRepoName = this._getECRRepoName();
    //Check if existing repo exists
    const ecrs = await this.plugin.serverless.getProvider('aws').request('ECR', 'describeRepositories', {});
    if (ecrs) {
      const existingECR = ecrs.repositories.find((repo) => repo.repositoryName == ECRRepoName);
      if (existingECR) {
        this.plugin.logger.info(`ECR repo ${ECRRepoName} already exists, skipping it!`);
        return BPromise.resolve();
      }
    }
    return this._createECRRepo(ECRRepoName);
  }
  public async build(): BPromise {
    return new BPromise(async (resolve, reject) => {
      // Check for unified build
      if (this.unifyEventsContainer && this.index != 0) {
        return resolve();
      }
      // 
      const localImageName = this._getECRRepoName();
      const ECRRepoURL: string = (await this._getFullECRRepoImageURL());
      //Build image
      const files = this.getContainerFiles();
      await this.plugin.docker.buildImage(files, `${localImageName}:${this.currentTag}`, this.event.runtime, this.getContainerBuildArgs());
      //Prepare to push to registry by tagging it 
      const tagResp = await this._runCommand(`docker tag ${localImageName}:${this.currentTag} ${ECRRepoURL}`, '');
      if (tagResp.stderr) reject(tagResp.stderr);
      //
      resolve();
    });
  }
  public async push(): BPromise {
    return new BPromise(async (resolve, reject) => {
      // Check for unified build
      if (this.unifyEventsContainer && this.index != 0) {
        return resolve();
      }
      //
      const ECRRepoURL: string = (await this._getFullECRRepoImageURL());
      //Authenticate with registry
      const authResp = await this._runCommand(`aws ecr get-login-password --region ${this.plugin.region} | docker login -u AWS ${ECRRepoURL} --password-stdin`, '', true);
      if (authResp.stderr && authResp.stderr.includes('ERROR') && !authResp.stderr.includes('The specified item already exists in the keychain')) reject(authResp.stderr);
      //Push to ECR
      this.plugin.logger.info(`Pushing docker image on repo ${this._getECRRepoName()}..`);
      const pushResp = await this._runCommand(`docker push ${ECRRepoURL}`, '');
      if (pushResp && pushResp.stderr && pushResp.stderr.toLowerCase().indexOf('error')) reject(pushResp.stderr);
      else if (!pushResp || pushResp.stdout.toLowerCase().indexOf('error') == -1) {
        if (pushResp && pushResp.stdout) this.plugin.logger.debug(pushResp.stdout);
        resolve();
      } else reject(pushResp.stdout);
    });
  }
  public async cleanup(): BPromise {
    // Check for unified build
    if (this.unifyEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    //
    const ECRRepoName = this._getECRRepoName();
    return await this._cleanupOldImages(ECRRepoName);
  }

  //public
  public async getContainerImageURL() { return this._getFullECRRepoImageURL(); }

  //subclasses support
  protected getContainerFiles(): DockerFiles { return null; }
  protected getContainerBuildArgs(): { [key: string]: string } | null { return null; }
  protected getContainerEnvironments(): any { return {}; }
  public async getClusterTask(): BPromise { return BPromise.resolve(); }

  //Private
  private _getECRRepoName(): string {
    return `${this.plugin.getName()}/${this.func.getName()}.${this.unifyEventsContainer ? 0 : this.index}-${this.plugin.stage}.v2`.toLowerCase();
  }
  private async _getFullECRRepoImageURL() {
    const accID = await this.plugin.getAccountID();
    return `${accID}.dkr.ecr.${this.plugin.region}.amazonaws.com` + `/${this._getECRRepoName()}:${this.currentTag}`;
  }
  protected _getTaskName(): string {
    return this.plugin.provider.naming.getNormalizedFunctionName(`Task${this.index}`);
  }

  //AWS Shorcut
  private async _createECRRepo(ECRRepoName: string): BPromise {
    //Create ECR
    this.plugin.logger.info(`Creating ECR repo ${ECRRepoName}..`);
    const createECR = await this.plugin.serverless.getProvider('aws').request('ECR', 'createRepository', {
      repositoryName: ECRRepoName, imageTagMutability: 'MUTABLE', tags: this.plugin.getDefaultTags()
    });
    if (createECR) {
      //Setup ECR lifecycle policy
      this.plugin.logger.info(`Setting ECR repo ${ECRRepoName} lifecycle policy..`);
      return await this.plugin.serverless.getProvider('aws').request('ECR', 'putLifecyclePolicy', {
        repositoryName: ECRRepoName, lifecyclePolicyText: JSON.stringify({
          "rules": [{
            "rulePriority": 1,
            "description": "Keep last 100 items (failsafe policy)",
            "selection": {
              "tagStatus": "any",
              "countType": "imageCountMoreThan",
              "countNumber": 100 //100 failed deployments should be more than enough :p
            },
            "action": {
              "type": "expire"
            }
          }]
        })
      });
    } else return BPromise.reject('Could not create ECR repo!');
  }
  private async _cleanupOldImages(ECRRepoName: string): BPromise {
    //Find ECR repo images
    this.plugin.logger.info(`Cleaning up old ECR images from: ${ECRRepoName}..`);
    const ecrImages = await this.plugin.serverless.getProvider('aws').request('ECR', 'listImages', {
      repositoryName: ECRRepoName, maxResults: 100
    });
    if (ecrImages && ecrImages.imageIds) {
      //filter out by removing just deployed image
      const removeImages = ecrImages.imageIds.filter((i) => i.imageTag != this.currentTag);
      //remove images if found
      if (removeImages.length > 0) {
        this.plugin.logger.info(`Cleaning up ${removeImages.length} unused images on ECR repo ${ECRRepoName}..`);
        return await this.plugin.serverless.getProvider('aws').request('ECR', 'batchDeleteImage', {
          repositoryName: ECRRepoName, imageIds: removeImages,
        });
      } else {
        this.plugin.logger.warn(`No images found on ECR repo ${ECRRepoName} to be cleaned; This should not happen unless you have manually changed the ECR lifecycle policy.`);
        return BPromise.resolve(); //dont need to throw for this :) 
      }
    } else return BPromise.reject('Could not find ECR repo images!');
  }

  //CMD helper
  private async _runCommand(command, params, allowFailure?: boolean): BPromise {
    return new BPromise(async (resolve, reject) => {
      if (!params) params = [];
      let formattedParams = params.join(' ');
      try {
        //@ts-ignore
        const resp = await executor(command + ' ' + formattedParams);
        resolve(resp);
      } catch (err) {
        if (allowFailure) {
          resolve(err);
        } else {
          this.plugin.logger.error('Error while running command', err.stdout.toString());
          reject(err);
        }
      }
    });
  }
}