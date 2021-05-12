import { FunctionBaseEvent } from "./FunctionBaseEvent"; //base class
//
import Hybridless = require("../..");
import { BaseFunction } from "../Function";
import { OFunctionEvent } from "../../options";
//
import BPromise = require('bluebird');
import util = require('util');
import child = require('child_process');
import Globals, { DockerFiles } from "../../core/Globals";
//
const executor = util.promisify(child.exec);
//
export class FunctionContainerBaseEvent extends FunctionBaseEvent<OFunctionEvent> {
    public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionEvent, index: number) {
        super(plugin, func, event, index);
        plugin.containerFunctions = true;
    }

    //Plugin lifecycle
    public async spread(): BPromise { return BPromise.resolve(); }
    public async checkDependecies(): BPromise {
        return new BPromise(async (resolve, reject) => {
            if (this.event['runtime'].indexOf('node') != -1 && !this.plugin.options.disableWebPack) this.plugin.depManager.enableWebpack();
            this.plugin.depManager.enableECSPlugin();
            resolve();
        });
    }
    public async createRequiredResources(): BPromise {
        const ECRRepoName = this._getECRRepoName();
        //Check if existing repo exists
        const ecrs = await this.plugin.serverless.getProvider('aws').request(
            'ECR', 'describeRepositories', {},
            this.plugin.serverless.getProvider('aws').getStage(),
            this.plugin.serverless.getProvider('aws').getRegion()
        );
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
        return new BPromise( async (resolve, reject) => {
            const localImageName = this._getECRRepoName();
            const ECRRepoURL: string = <string> await this._getECRRepo(true);
            //Build image
            const files = this.getContainerFiles();
            await this.plugin.docker.buildImage(files, localImageName, this.event['runtime']);
            //Prepare to push to registry by tagging it 
            const tagResp = await this._runCommand(`docker tag ${localImageName}:${Globals.DockerLatestTag} ${ECRRepoURL}`, '');
            if (tagResp.stderr) reject(tagResp.stderr);
            //
            resolve();
        });
    }
    public async push(): BPromise {
        return new BPromise(async (resolve, reject) => {
            const ECRRepoURL: string = <string>await this._getECRRepo(true);
            //Authenticate with registry
            const authResp = await this._runCommand(`aws ecr get-login-password --region ${this.plugin.region} | docker login -u AWS ${ECRRepoURL} --password-stdin`, '');
            if (authResp.stderr && authResp.stderr.includes('ERROR')) reject(authResp.stderr);
            //Push to ECR
            this.plugin.logger.info(`Pushing docker image on repo ${this._getECRRepoName()}..`);
            const pushResp = await this._runCommand(`docker push ${ECRRepoURL}`, '');
            if (pushResp.stderr && pushResp.stderr.includes('ERROR')) reject(pushResp.stderr);
            //
            resolve();
        });
    }
    
    //Super support
    protected getContainerFiles(): DockerFiles { return null; }
    protected getContainerEnvironments(): any { return {}; } 
    public async getClusterTask(): BPromise { return BPromise.resolve(); }

    //Private Naming
    protected _getECRRepoName(): string {
        return `${this.plugin.getName()}/${this.func.getName()}.${this.index}-${this.plugin.stage}.v2`.toLowerCase();
    }
    protected async _getECRRepo(includeRepoName: boolean) {
        const accID = await this.plugin.getAccountID();
        return `${accID}.dkr.ecr.${this.plugin.region}.amazonaws.com` + (includeRepoName ? `/${this._getECRRepoName()}:${Globals.DockerLatestTag}` : '');
    }
    protected _getTaskName(): string {
        return this.plugin.provider.naming.getNormalizedFunctionName(`Task${this.index}`);
    }

    //Helper
    private async _runCommand(command, params): BPromise {
        return new BPromise( async (resolve, reject) => {
            let resp = {};
            if (!params) params = [];
            let formattedParams = params.join(' ');
            try {
                //@ts-ignore
                const resp = await executor(command + ' ' + formattedParams);
                resolve(resp);
            } catch (err) {
                this.plugin.logger.error('Error while running command', err);
                reject(err);
            }
        });
    }

    //AWS Shorcut
    private async _createECRRepo(ECRRepoName: string): BPromise {
        //Create ECR
        this.plugin.logger.info(`Creating ECR repo ${ECRRepoName}..`);
        const createECR = await this.plugin.serverless.getProvider('aws').request(
            'ECR',
            'createRepository',
            { repositoryName: ECRRepoName, imageTagMutability: 'MUTABLE', tags: this.plugin.getDefaultTags() },
            this.plugin.serverless.getProvider('aws').getStage(),
            this.plugin.serverless.getProvider('aws').getRegion()
        );
        if (createECR) {
            //Setup ECR lifecycle policy
            this.plugin.logger.info(`Setting ECR repo ${ECRRepoName} lifecycle policy..`);
            const accID = await this.plugin.getAccountID();
            return await this.plugin.serverless.getProvider('aws').request(
                'ECR',
                'putLifecyclePolicy',
                {
                    repositoryName: ECRRepoName, registryId: accID, lifecyclePolicyText: JSON.stringify({
                        "rules": [
                            {
                                "rulePriority": 1,
                                "description": "Keep only one untagged image, expire all others",
                                "selection": {
                                    "tagStatus": "untagged",
                                    "countType": "imageCountMoreThan",
                                    "countNumber": 1
                                },
                                "action": {
                                    "type": "expire"
                                }
                            }
                        ]
                    })
                },
                this.plugin.serverless.getProvider('aws').getStage(),
                this.plugin.serverless.getProvider('aws').getRegion()
            );
        } else return BPromise.reject('Could not create ECR repo!');
    }
}