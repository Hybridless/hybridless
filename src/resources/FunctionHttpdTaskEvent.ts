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
        plugin.containerFunctions = true;
    }
    /* Container Base Event Overwrites */
    protected getContainerFiles(): DockerFiles {
        return Globals.HTTPD_DockerFilesByRuntime((<OFunctionHTTPDTaskEvent>this.event).runtime, this.plugin.serverless.config.servicePath, this.func.funcOptions.handler, this.healthRoute, (<OFunctionHTTPDTaskEvent>this.event).dockerFile);
    }
    protected getContainerEnvironments(): any {
        const event: OFunctionHTTPDTaskEvent = (<OFunctionHTTPDTaskEvent>this.event);
        const isPHP = (event.runtime == OFunctionHttpdTaskRuntime.php5 || event.runtime == OFunctionHttpdTaskRuntime.php7);
        return {
            //Plataform specific
            ...(!isPHP ? {
                'HYBRIDLESS_RUNTIME': true,
                'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1,
                'ENTRYPOINT': `./${this.func.getEntrypoint(this.event)}`,
                'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
                // Proxy
                'PORT': this.getPort(),
                ...(event.cors ? { 'CORS': JSON.stringify(event.cors) } : {}),
                'TIMEOUT': (this.func.funcOptions.timeout || Globals.HTTPD_DefaultTimeout) * 1000,
                // Analytics
                ...(event.newRelicKey ? {
                    'NEW_RELIC_APP_NAME': `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
                    'NEW_RELIC_LICENSE_KEY': event.newRelicKey,
                    'NEW_RELIC_ENABLED': true,
                    'NEW_RELIC_NO_CONFIG_FILE': true,
                } : {
                    'NEW_RELIC_ENABLED': false
                }),
            } : {
                'WEB_DOCUMENT_INDEX': this.func.getEntrypointFunction(this.event)
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
                ...(event.priority && event.priority != -1 ? { priority: event.priority } : {}),
                disableELB: false,
                taskRoleArn: (event.role || { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] }),
                image: `${ECRRepoFullURL}`,
                //Service
                desiredCount: (event.concurrency || Globals.HTTPD_DefaultConcurrency),
                ec2LaunchType: !!event.ec2LaunchType,
                environment: {
                    ...this.plugin.getEnvironmentIvars(),
                    ...this.getContainerEnvironments(),
                },
                ...(event.autoScale && <unknown>event.autoScale != 'null' ? { autoScale: event.autoScale } : {}),
                logsMultilinePattern: (event.logsMultilinePattern || Globals.DefaultLogsMultilinePattern),
                //ALB
                ...(event.hostname && event.hostname != 'null' ? { hostname: event.hostname } : {}),
                ...(event.limitSourceIPs && event.limitSourceIPs != 'null' ? { limitSourceIPs: event.limitSourceIPs } : {}),
                healthCheckUri: this.healthRoute,
                healthCheckProtocol: 'HTTP',
                healthCheckInterval: (event.healthCheckInterval || Globals.DefaultHealthCheckInterval),
                healthCheckTimeout: (event.healthCheckTimeout || Globals.DefaultHealthCheckTimeout),
                healthCheckHealthyCount: (event.healthCheckHealthyCount ||Globals.DefaultHealthCheckHealthyCount),
                healthCheckUnhealthyCount: (event.healthCheckUnhealthyCount ||Globals.DefaultHealthCheckUnhealthCount),
                path: event.routes.map((route: any ) => {
                    return { path: route.path, method: route.method };
                }),
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

    private getPort(): number {
        const event: OFunctionHTTPDTaskEvent = <OFunctionHTTPDTaskEvent>this.event;
        const isPHP = (event.runtime == OFunctionHttpdTaskRuntime.php5 || event.runtime == OFunctionHttpdTaskRuntime.php7);
        return (event.port || ((event.certificateArns && isPHP == false) ? 443 : 80));
    }
}