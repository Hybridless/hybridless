import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionHTTPDTaskEvent, OFunctionHttpdTaskRuntime } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionHTTPDTaskEvent extends FunctionContainerBaseEvent {
    private healthRoute: string;
    public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionHTTPDTaskEvent, index: number) {
        super(plugin, func, event, index);
        this.healthRoute = Globals.HTTPD_HealthCheckByRuntime(event.runtime);
    }
    /* Container Base Event Overwrites */
    protected getContainerFiles(): DockerFiles {
        const environment = (<OFunctionHTTPDTaskEvent>this.event).runtime;
        const customDockerFile = (<OFunctionHTTPDTaskEvent>this.event).dockerFile;
        const serverlessDir = this.plugin.serverless.config.servicePath;
        const additionalDockerFiles = ((<OFunctionHTTPDTaskEvent>this.event).additionalDockerFiles || []).map((file) => {
            return { name: file.from, dir: serverlessDir, dest: file.to }
        });
        //Get build directory
        let safeDir: any = __dirname.split('/');
        safeDir.splice(safeDir.length - 1, 1);
        safeDir = safeDir.join('/');
        //Nodejs Specific
        if (environment == OFunctionHttpdTaskRuntime.nodejs10 || environment == OFunctionHttpdTaskRuntime.nodejs13) {
            return [
                (customDockerFile ?
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: Globals.HTTPD_ImageByRuntime(environment), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
                { name: 'task-httpd/Index-Httpd-NodejsX', dir: safeDir + '/resources/assets', dest: 'proxy.js' },
                { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' },
                ...additionalDockerFiles
            ];
        } else if (environment == OFunctionHttpdTaskRuntime.php5 || environment == OFunctionHttpdTaskRuntime.php7) { 
            //get handler path and remove index.php 
            const handler = this.func.funcOptions.handler;
            const handleRootFolder = (handler.indexOf('.php') != -1 ? handler.split('/').splice(0, handler.split('/').length - 1).join('/') : handler);
            return [
                (customDockerFile ?
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: Globals.HTTPD_ImageByRuntime(environment), dir: safeDir + '/resources/assets', dest: 'Dockerfile' }
                ),
                { name: 'task-httpd/healthCheck.php', dir: safeDir + '/resources/assets', dest: `/app/${this.healthRoute}` },
                { name: handleRootFolder, dir: serverlessDir, dest: '/app/' },
                ...additionalDockerFiles
            ];
        } else if (environment == OFunctionHttpdTaskRuntime.container) {
            return [
                { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' },
                ...additionalDockerFiles
            ];
        } else {
            throw new Error(`Unrecognized HTTP event type ${environment}!`);
        }
    }
    protected getContainerEnvironments(): any {
        const event: OFunctionHTTPDTaskEvent = (<OFunctionHTTPDTaskEvent>this.event);
        const isPHP = (event.runtime == OFunctionHttpdTaskRuntime.php5 || event.runtime == OFunctionHttpdTaskRuntime.php7);
        const isNodeJS = (event.runtime == OFunctionHttpdTaskRuntime.nodejs10 || event.runtime == OFunctionHttpdTaskRuntime.nodejs13);
        const isPureContainer = (event.runtime == OFunctionHttpdTaskRuntime.container);
        return {
            //Plataform specific
            ...(isNodeJS && {
                'HYBRIDLESS_RUNTIME': true,
                'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1,
                'ENTRYPOINT': `./${this.func.getEntrypoint(this.event)}`,
                'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
                // Proxy
                'PORT': this.getPort(),
                ...(event.cors ? { 'CORS': JSON.stringify(event.cors) } : {}),
                'TIMEOUT': (this.func.funcOptions.timeout || Globals.HTTPD_DefaultTimeout) * 1000,
            }),
            ...(isPHP && {
                'WEB_DOCUMENT_INDEX': this.func.getEntrypointFunction(this.event)
            }),
            ...(isPureContainer && {
                'ENTRYPOINTY': event.entrypoint
            }),
            // Analytics
            ...(event.newRelicKey ? {
                'NEW_RELIC_APP_NAME': `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
                'NEW_RELIC_LICENSE_KEY': event.newRelicKey,
                'NEW_RELIC_ENABLED': true,
                'NEW_RELIC_NO_CONFIG_FILE': true,
            } : {
                'NEW_RELIC_ENABLED': false
            }),
            // General
            'STAGE': this.plugin.stage,
            'AWS_REGION': { "Ref": "AWS::Region" },
            'AWS_ACCOUNT_ID': { "Ref": "AWS::AccountId" },
            'ECS_ENABLE_CONTAINER_METADATA': true,
            'HEALTH_ROUTE': this.healthRoute,
        };
    }
    public async getClusterTask(): BPromise {
        const TaskName = this._getTaskName();
        const ECRRepoFullURL = await this._getECRRepo(true);
        const event: OFunctionHTTPDTaskEvent = (<OFunctionHTTPDTaskEvent>this.event);
        return new BPromise(async (resolve) => {
            resolve({
                name: TaskName,
                //Task
                cpu: (event.cpu || Globals.HTTPD_DefaultCPU),
                memory: (event.memory || this.func.funcOptions.memory || Globals.HTTPD_DefaultMemory),
                port: this.getPort(),
                disableELB: false,
                taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
                image: `${ECRRepoFullURL}`,
                ...(event.entrypoint ? { entrypoint: event.entrypoint } : {}),
                //Service
                desiredCount: (event.concurrency || Globals.HTTPD_DefaultConcurrency),
                ec2LaunchType: !!event.ec2LaunchType,
                ...(!!event.ec2LaunchType && event.daemonType ? { daemonEc2Type: true } : {}),
                environment: {
                    ...this.plugin.getEnvironmentIvars(),
                    ...this.getContainerEnvironments(),
                },
                ...(event.autoScale && <unknown>event.autoScale != 'null' ? { autoScale: event.autoScale } : {}),
                logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
                ...(event.placementStrategies && <unknown>event.placementStrategies != 'null' ? { placementStrategies: event.placementStrategies } : {}),
                ...(event.placementConstraints && <unknown>event.placementConstraints != 'null' ? { placementConstraints: event.placementConstraints } : {}),
                ...(event.capacityProviderStrategy && <unknown>event.capacityProviderStrategy != 'null' ? { capacityProviderStrategy: event.capacityProviderStrategy } : {}),
                ...(event.propagateTags && <unknown>event.propagateTags != 'null' ? { propagateTags: event.propagateTags } : {}),
                //ALB
                ...(event.hostname && event.hostname != 'null' ? { hostname: event.hostname } : {}),
                ...(event.limitSourceIPs && event.limitSourceIPs != 'null' ? { limitSourceIPs: event.limitSourceIPs } : {}),
                ...(event.limitHeaders ? {
                    limitHeaders: event.limitHeaders.map((h) => ({ Name: h.name, Value: h.value }))
                } : {}),
                path: event.routes.map((route: any) => {
                    return { path: route.path, method: route.method || 'ANY', priority: route.priority || 1 };
                }),
                //Health check
                healthCheckUri: (event.healthCheckRoute || this.healthRoute),
                healthCheckProtocol: 'HTTP',
                healthCheckInterval: (event.healthCheckInterval || Globals.DefaultHealthCheckInterval),
                healthCheckTimeout: (event.healthCheckTimeout || Globals.DefaultHealthCheckTimeout),
                healthCheckHealthyCount: (event.healthCheckHealthyCount ||Globals.DefaultHealthCheckHealthyCount),
                healthCheckUnhealthyCount: (event.healthCheckUnhealthyCount ||Globals.DefaultHealthCheckUnhealthCount),
                protocols: [{ 
                    protocol: (event.certificateArns ? 'HTTPS' : 'HTTP'),
                    ...(event.certificateArns ? {
                        'certificateArns': event.certificateArns
                    } : {}),
                    ...(event.certificateArns && event.cognitoAuthorizer ? {
                        'authorizer': {
                            poolArn: event.cognitoAuthorizer.poolArn,
                            clientId: event.cognitoAuthorizer.clientId,
                            poolDomain: event.cognitoAuthorizer.poolDomain
                        }
                    }: {})
                }]
            });
        });
    }

    /* Privates */
    private getPort(): number {
        const event: OFunctionHTTPDTaskEvent = <OFunctionHTTPDTaskEvent>this.event;
        const isPHP = (event.runtime == OFunctionHttpdTaskRuntime.php5 || event.runtime == OFunctionHttpdTaskRuntime.php7);
        return (event.port || ((event.certificateArns && isPHP == false) ? 443 : 80));
    }
}