import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionLambdaContainerEvent, OFunctionLambdaProtocol } from "../options";
//
import Globals, { DockerFiles } from "../core/Globals";
//
import BPromise = require('bluebird');
//
export class FunctionLambdaContainerEvent extends FunctionContainerBaseEvent {
    public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionLambdaContainerEvent, index: number) {
        super(plugin, func, event, index);
    }
    /* Base Event Overwrites */
    public async spread(): BPromise {
        return new BPromise(async (resolve) => {
            //generate lambda
            const lambda = await this.generateLambdaFunction();
            this.plugin.appendServerlessFunction(lambda);
            //Check if needs authorizer
            const authorizer = this.generateCognitoAuthorizer();
            if (authorizer) this.plugin.appendResource(this._getAuthorizerName(), authorizer);
            resolve();
        });
    }
    /* Container Base Event Overwrites */
    protected getContainerFiles(): DockerFiles {
        return Globals.LambdaContainer_DockerFilesByRuntime((<OFunctionLambdaContainerEvent>this.event).runtime, this.plugin.serverless.config.servicePath, (<OFunctionLambdaContainerEvent>this.event).dockerFile);
    }
    protected getContainerEnvironments(): any {
        const event: OFunctionLambdaContainerEvent = (<OFunctionLambdaContainerEvent>this.event);
        return {
            'AWS_NODEJS_CONNECTION_REUSE_ENABLED': 1,
            'ENTRYPOINT': `${this.func.getEntrypoint(this.event)}`,
            'ENTRYPOINT_FUNC': this.func.getEntrypointFunction(this.event),
        };
    }
    /* lambda helpers */
    private async generateLambdaFunction(): Promise<any> {
        const proto = (<OFunctionLambdaContainerEvent>this.event).protocol || OFunctionLambdaProtocol.http;
        const allowsRouting = (proto == OFunctionLambdaProtocol.http);
        const sanitizedRoutes = (allowsRouting ? (<OFunctionLambdaContainerEvent>this.event).routes : [null]);
        const repoName = await this._getECRRepo(true);
        return {
            [this._getFunctionName()]: {
                name: `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
                //container
                image: repoName,
                environment: {
                    ...this.getContainerEnvironments(),
                    ...this.plugin.getEnvironmentIvars()
                },
                //default stuff
                ...this.func.getVPC(true),
                ...(this.func.funcOptions.timeout ? { timeout: this.func.funcOptions.timeout } : { timeout: Globals.HTTPD_DefaultTimeout }),
                ...(this.func.funcOptions.memory || (<OFunctionLambdaContainerEvent>this.event).memory ? { memorySize: this.func.funcOptions.memory || (<OFunctionLambdaContainerEvent>this.event).memory } : {}),
                ...((<OFunctionLambdaContainerEvent>this.event).reservedConcurrency ? { reservedConcurrency: (<OFunctionLambdaContainerEvent>this.event).reservedConcurrency } : {}),
                tracing: true, //enable x-ray tracing by default,
                versionFunctions: false, //disable function versions be default
                //Lambda events (routes for us)
                ...(sanitizedRoutes && sanitizedRoutes.length > 0 ? {
                    events: sanitizedRoutes.map((route) => {
                        const proto = (<OFunctionLambdaContainerEvent>this.event).protocol || OFunctionLambdaProtocol.http;
                        proto == OFunctionLambdaProtocol.http
                        const sanitizedRoute = (!route || route.path == '*' ? '{proxy+}' : route.path);
                        return {
                            [this._getProtocolName(proto)]: {
                                ...(allowsRouting && route ? { path: sanitizedRoute } : {}),
                                ...(allowsRouting && route && route.method ? { method: route.method } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).cors ? { cors: (<OFunctionLambdaContainerEvent>this.event).cors } : {}),
                                ...(proto == OFunctionLambdaProtocol.dynamostreams ? { type: 'dynamodb' } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).prototocolArn ? { arn: (<OFunctionLambdaContainerEvent>this.event).prototocolArn } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).queueBatchSize ? { batchSize: (<OFunctionLambdaContainerEvent>this.event).queueBatchSize } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).schedulerRate ? { rate: (<OFunctionLambdaContainerEvent>this.event).schedulerRate } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).schedulerInput ? { input: (<OFunctionLambdaContainerEvent>this.event).schedulerInput } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).filterPolicy ? { filterPolicy: (<OFunctionLambdaContainerEvent>this.event).filterPolicy } : {}),
                                ...((<OFunctionLambdaContainerEvent>this.event).cognitoAuthorizerArn ? {
                                    "authorizer": {
                                        "type": "COGNITO_USER_POOLS",
                                        "authorizerId": { "Ref": this._getAuthorizerName() }
                                    }
                                } : {}),
                            }
                        };
                    })
                } : {}),

            }
        };
    }
    /* Cognito authorizer stuff */
    private generateCognitoAuthorizer(): any {
        if ((<OFunctionLambdaContainerEvent>this.event).cognitoAuthorizerArn) {
            return {
                'Type': 'AWS::ApiGateway::Authorizer',
                'Properties': {
                    'AuthorizerResultTtlInSeconds': 300,
                    'IdentitySource': 'method.request.header.Authorization',
                    'Name': this._getAuthorizerName(),
                    'RestApiId': { 'Ref': 'ApiGatewayRestApi' },
                    'Type': 'COGNITO_USER_POOLS',
                    'ProviderARNs': [(<OFunctionLambdaContainerEvent>this.event).cognitoAuthorizerArn]
                }
            }
        } return null;
    }
    /* Naming */
    private _getProtocolName(proto: OFunctionLambdaProtocol): string {
        if (proto == OFunctionLambdaProtocol.dynamostreams) return 'stream';
        else if (proto == OFunctionLambdaProtocol.scheduler) return 'schedule';
        return proto;
    }
    private _getFunctionName(suffix?: string): string {
        return `${this.plugin.getName()}${this.func.getName()}${this.plugin.stage}` + (suffix || '');
    }
    private _getAuthorizerName(): string {
        return this._getFunctionName('Authorizer');
    }
}