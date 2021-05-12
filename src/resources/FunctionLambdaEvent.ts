import { FunctionBaseEvent } from "./BaseEvents/FunctionBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionLambdaEvent, OFunctionLambdaProtocol } from "../options";
//
import BPromise = require('bluebird');
import Globals from "../core/Globals";
//
export class FunctionLambdaEvent extends FunctionBaseEvent<OFunctionLambdaEvent> {
    public constructor(plugin: Hybridless, func: BaseFunction, event: OFunctionLambdaEvent, index: number) {
        super(plugin, func, event, index);
    }
    //Plugin lifecycle
    public async spread(): BPromise {
        return new BPromise(async (resolve) => {
            //generate lambda
            const lambda = this.generateLambdaFunction();
            this.plugin.appendServerlessFunction(lambda);
            //Check if needs authorizer
            const authorizer = this.generateCognitoAuthorizer();
            if (authorizer) this.plugin.appendResource(this._getAuthorizerName(), authorizer);
            resolve();
        });
    }
    public async checkDependecies(): BPromise { return BPromise.resolve(); }
    public async createRequiredResources(): BPromise { return BPromise.resolve(); }
    public async build(): BPromise { return BPromise.resolve(); }
    public async push(): BPromise { return BPromise.resolve(); }

    /* lambda helpers */
    private generateLambdaFunction(): any {
        const proto = this.event.protocol || OFunctionLambdaProtocol.http;
        const allowsRouting = (proto == OFunctionLambdaProtocol.http);
        const sanitizedRoutes = (allowsRouting ? this.event.routes : [null]);
        return {
            [this._getFunctionName()]: {
                name: `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
                //default stuff
                handler: this.func.funcOptions.handler,
                ...this.func.getVPC(true),
                ...(this.func.funcOptions.timeout ? { timeout: this.func.funcOptions.timeout } : { timeout: Globals.HTTPD_DefaultTimeout }),
                ...(this.func.funcOptions.memory || this.event.memory ? { memorySize: this.func.funcOptions.memory || this.event.memory } : {}),
                ...(this.event.runtime ? { runtime: this.event.runtime } : {}),
                ...(this.event.layers ? { layers: this.event.layers } : {}),
                ...(this.event.reservedConcurrency ? { reservedConcurrency: this.event.reservedConcurrency } : {}),
                tracing: true, //enable x-ray tracing by default,
                versionFunctions: false, //disable function versions be default
                //Lambda events (routes for us)
                ...(sanitizedRoutes && sanitizedRoutes.length > 0 ? {
                    events: sanitizedRoutes.map((route) => {
                        const proto = this.event.protocol || OFunctionLambdaProtocol.http;
                        proto == OFunctionLambdaProtocol.http
                        const sanitizedRoute = (!route || route.path == '*' ? '{proxy+}' : route.path);
                        return {
                            [this._getProtocolName(proto)]: {
                                ...(allowsRouting && route ? { path: sanitizedRoute } : {}),
                                ...(allowsRouting && route && route.method ? { method: route.method } : {}),
                                ...(this.event.cors ? { cors: this.event.cors } : {}),
                                ...(proto == OFunctionLambdaProtocol.dynamostreams ? { type: 'dynamodb' } : {}),
                                ...(this.event.prototocolArn ? { arn: this.event.prototocolArn } : {}),
                                ...(this.event.queueBatchSize ? { batchSize: this.event.queueBatchSize } : {}),
                                ...(this.event.schedulerRate ? { rate: this.event.schedulerRate } : {}),
                                ...(this.event.schedulerInput ? { input: this.event.schedulerInput } : {}),
                                ...(this.event.filterPolicy ? { filterPolicy: this.event.filterPolicy } : {}),
                                ...(this.event.cognitoAuthorizerArn ? { 
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
    /* Cognito authorizer */
    private generateCognitoAuthorizer(): any {
        if (this.event.cognitoAuthorizerArn) {
            return {
                'Type': 'AWS::ApiGateway::Authorizer',
                'Properties': {
                    'AuthorizerResultTtlInSeconds': 300,
                    'IdentitySource': 'method.request.header.Authorization',
                    'Name': this._getAuthorizerName(),
                    'RestApiId': { 'Ref': 'ApiGatewayRestApi' },
                    'Type': 'COGNITO_USER_POOLS',
                    'ProviderARNs': [ this.event.cognitoAuthorizerArn ]
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