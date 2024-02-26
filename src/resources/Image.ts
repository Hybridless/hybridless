import { OFunction, OFunctionEvent, OFunctionBatchJobEvent, OVPCOptions_Shared, OVPCOptions_Dedicated, OFunctionProcessTaskEvent, OFunctionLaunchableTaskEvent, OFunctionHTTPDTaskEvent, OFunctionEventType, OFunctionLambdaEvent, OFunctionLambdaContainerEvent, OFunctionScheduledTaskEvent, OImage } from "../options";
import Hybridless = require("..");
import * as PromisePool from "es6-promise-pool";
import util = require('util');
import child = require('child_process');
//Event types
import { FunctionProcessTaskEvent } from "./FunctionProcessTaskEvent";
import { FunctionHTTPDTaskEvent } from "./FunctionHttpdTaskEvent";
import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent";
import { FunctionBaseEvent } from "./BaseEvents/FunctionBaseEvent";
import { FunctionLambdaEvent } from "./FunctionLambdaEvent";
import { FunctionLambdaContainerEvent } from "./FunctionLambdaContainerEvent";
import { FunctionBatchJobEvent } from "./FunctionBatchJobEvent";
import { FunctionScheduledTaskEvent } from "./FunctionScheduledTaskEvent";
import { FunctionLaunchableTaskEvent } from "./FunctionLaunchableTaskEvent";
//
import _ = require('lodash');
import BPromise = require('bluebird');
import Globals, { DockerFiles } from "../core/Globals";
// 
const executor = util.promisify(child.exec);

export class Image {
  private imageOptions: OImage;
  private readonly plugin: Hybridless;
  public readonly imageName: string;
  private readonly currentTag: string;
  private readonly dockerFilePath: string;
  //
  public constructor(plugin: Hybridless, imageOptions: OImage, imageName: string, dockerFilePath?: string) {
    this.plugin = plugin;
    this.imageOptions = imageOptions;
    this.imageName = imageName;
    this.currentTag = Date.now() + '';
    this.dockerFilePath = dockerFilePath;
  }

  //setter
  public set options(options: OImage) {
    this.imageOptions = options;
  }
  // public get funcOptions() { return this._funcOptions; }

  //public
  public async getContainerImageURL() { return this._getFullECRRepoImageURL(); }

  //Plugin life cycle
  public async spread(): BPromise {
    return new BPromise.resolve()
  }
  public async checkDependencies(): BPromise {
    return new BPromise.resolve();
  }
  //create image extra required resources (ECR for example)
  public async createRequiredResources(nextToken?: string): BPromise {
    const ECRRepoName = this._getECRRepoName();
    //Check if existing repo exists
    const ecrs = await this.plugin.serverless.getProvider('aws').request('ECR', 'describeRepositories', {
      ...(nextToken ? { nextToken } : {})
    });
    if (ecrs) {
      const existingECR = ecrs.repositories.find((repo) => repo.repositoryName == ECRRepoName);
      if (existingECR) {
        this.plugin.logger.info(`ECR repo ${ECRRepoName} already exists, skipping it!`);
        return BPromise.resolve();
      } else if (ecrs.nextToken) { /* check if read was capped */
        // check again with nextToken
        return this.createRequiredResources(ecrs.nextToken);
      }
    }
    return this._createECRRepo(ECRRepoName);
  }
  //build events (images)
  public async build(): BPromise {
    //For type of event, compile the function
    return new BPromise(async (resolve, reject) => {
      const localImageName = this._getECRRepoName();
      const ECRRepoURL: string = (await this._getFullECRRepoImageURL());
      //Build image
      const files = this.getContainerFiles();
      await this.plugin.docker.buildImage(files, `${localImageName}:${this.currentTag}`, this.getContainerBuildArgs());
      //Prepare to push to registry by tagging it 
      const tagResp = await this._runCommand(`docker tag ${localImageName}:${this.currentTag} ${ECRRepoURL}`, '');
      if (tagResp.stderr) reject(tagResp.stderr);
      //
      resolve();
    });
  }
  //push events (images)
  public async push(): BPromise {
    //For type of event, spread the function
    return new BPromise(async (resolve) => {
      await new BPromise(async (resolve, reject) => {
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
      resolve();
    });
  }
  //cleanup events
  public async cleanup(): BPromise {
    const ECRRepoName = this._getECRRepoName();
    return await this._cleanupOldImages(ECRRepoName);
  }
  //delete events
  public async delete(): BPromise {
    const ECRRepoName = this._getECRRepoName();
    return await this._deleteECRRepo(ECRRepoName);
  }

  
  //Private
  private getContainerFiles(): DockerFiles { 
    const customDockerFile = this.imageOptions.dockerFile;
    const serverlessDir = this.plugin.serverless.config.servicePath;
    const additionalDockerFiles = (this.imageOptions.additionalDockerFiles || []).map((file) => {
      return { name: file.from, dir: file.path || serverlessDir, dest: file.to }
    });
    return [
      { name: customDockerFile, dir: this.dockerFilePath || serverlessDir, dest: 'Dockerfile' },
      ...additionalDockerFiles
    ]
  }
  protected getContainerBuildArgs(): { [key: string]: string } | null { return this.imageOptions.dockerBuildArgs; }
  private _getECRRepoName(): string {
    return `${this.plugin.getName()}/${this.imageName}-${this.plugin.stage}.v3`.toLowerCase();
  }
  private async _getFullECRRepoImageURL() {
    const accID = await this.plugin.getAccountID();
    return `${accID}.dkr.ecr.${this.plugin.region}.amazonaws.com` + `/${this._getECRRepoName()}:${this.currentTag}`;
  }
  //Docker
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

  private async _deleteECRRepo(ECRRepoName: string): BPromise {
    //Create ECR
    this.plugin.logger.info(`Deleting ECR repo ${ECRRepoName}..`);
    return await this.plugin.serverless.getProvider('aws').request('ECR', 'deleteRepository', {
      repositoryName: ECRRepoName, force: true
    });
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
}