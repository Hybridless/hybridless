import { FunctionContainerBaseEvent } from "./BaseEvents/FunctionContainerBaseEvent"; //base class
//
import Hybridless = require("..");
import { BaseFunction } from "./Function";
import { OFunctionLambdaCloudWatchEvent, OFunctionLambdaCloudWatchLogStream, OFunctionLambdaCognitoTrigger, OFunctionLambdaContainerEvent, OFunctionLambdaHTTPEvent, OFunctionLambdaProtocol, OFunctionLambdaS3Event, OFunctionLambdaSchedulerEvent, OFunctionLambdaSNSEvent, OFunctionLambdaSQSEvent } from "../options";
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
            const lambda = await this._generateLambdaFunction();
            this.plugin.appendServerlessFunction(lambda);
            //Check if needs authorizer
            const authorizer = this._generateCognitoAuthorizer();
            if (authorizer) this.plugin.appendResource(this._getAuthorizerName(), authorizer);
            resolve();
        });
    }
    /* Container Base Event Overwrites */
    protected getContainerFiles(): DockerFiles {
        const environment = (<OFunctionLambdaContainerEvent>this.event).runtime;
        const dockerFileName = Globals.LambdaContainer_ImageByRuntime(environment);
        const customDockerFile = (<OFunctionLambdaContainerEvent>this.event).dockerFile;
        const serverlessDir = this.plugin.serverless.config.servicePath;
        const additionalDockerFiles = ((<OFunctionLambdaContainerEvent>this.event).additionalDockerFiles || []).map((file) => {
            return { name: file.from, dir: serverlessDir, dest: file.to }
        });
        //Get build directory
        let safeDir: any = __dirname.split('/');
        safeDir.splice(safeDir.length - 1, 1);
        safeDir = safeDir.join('/');
        //
        return [
            (customDockerFile ?
                { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                { name: dockerFileName, dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
            { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' },
            ...additionalDockerFiles
        ];
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
    private async _generateLambdaFunction(): BPromise<any> {
        const event: OFunctionLambdaContainerEvent = (<OFunctionLambdaContainerEvent>this.event);
        const allowsRouting = (this.event.runtime == OFunctionLambdaProtocol.http);
        const sanitizedRoutes = (allowsRouting ? (this.event as OFunctionLambdaHTTPEvent).routes : [null]); //important, leave one null object if not http
        const repoName = await this._getECRRepo(true);
        return {
            [this._getFunctionName()]: {
                name: `${this.plugin.getName()}-${this.func.getName()}-${this.plugin.stage}`,
                //container
                image: repoName,
                environment: {
                    ...this.plugin.getEnvironmentIvars(),
                    ...this.getContainerEnvironments(),
                },
                //default stuff
                ...this.func.getVPC(true),
                ...(this.func.funcOptions.timeout ? { timeout: this.func.funcOptions.timeout } : { timeout: Globals.HTTPD_DefaultTimeout }),
                ...(this.func.funcOptions.memory || event.memory ? { memorySize: this.func.funcOptions.memory || event.memory } : {}),
                ...(event.reservedConcurrency ? { reservedConcurrency: event.reservedConcurrency } : {}),
                tracing: (event.disableTracing ? false : true), //enable x-ray tracing by default,
                versionFunctions: false, //disable function versions be default
                //Lambda events means routes on this scope
                ...(sanitizedRoutes && sanitizedRoutes.length > 0 ? {
                    events: sanitizedRoutes.map((route) => {
                        const proto = event.protocol || OFunctionLambdaProtocol.http;
                        proto == OFunctionLambdaProtocol.http
                        return {
                            [this._getProtocolName(proto)]: {
                                //multiple
                                ...((this.event as OFunctionLambdaSNSEvent).prototocolArn ? { arn: (this.event as OFunctionLambdaSNSEvent).prototocolArn } : {}),
                                //sqs
                                ...((this.event as OFunctionLambdaSQSEvent).queueBatchSize ? { batchSize: (this.event as OFunctionLambdaSQSEvent).queueBatchSize } : {}),
                                //ddbstreams
                                ...((<OFunctionLambdaContainerEvent>this.event).protocol == OFunctionLambdaProtocol.dynamostreams ? { type: 'dynamodb' } : {}),
                                //scheduler
                                ...((this.event as OFunctionLambdaSchedulerEvent).schedulerRate ? { rate: (this.event as OFunctionLambdaSchedulerEvent).schedulerRate } : {}),
                                ...((this.event as OFunctionLambdaSchedulerEvent).schedulerInput ? { input: 
                                    typeof (this.event as OFunctionLambdaSchedulerEvent).schedulerInput == 'string' ? 
                                        (this.event as OFunctionLambdaSchedulerEvent).schedulerInput : JSON.stringify((this.event as OFunctionLambdaSchedulerEvent).schedulerInput)
                                } : {}),
                                //sns
                                ...((this.event as OFunctionLambdaSNSEvent).filterPolicy ? { filterPolicy: (this.event as OFunctionLambdaSNSEvent).filterPolicy } : {}),
                                //s3
                                ...((this.event as OFunctionLambdaS3Event).s3bucket ? { s3: {
                                    bucket: (this.event as OFunctionLambdaS3Event).s3bucket,
                                    ...((this.event as OFunctionLambdaS3Event).s3event ? { event: (this.event as OFunctionLambdaS3Event).s3event } : {}),
                                    ...((this.event as OFunctionLambdaS3Event).s3bucketExisting ? { existing: true } : {}),
                                    ...((this.event as OFunctionLambdaS3Event).s3rules ? { rules: (this.event as OFunctionLambdaS3Event).s3rules } : {}),
                                }} : {}),
                                //cloudwatch
                                ...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource ? {
                                    input: (typeof (this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource == 'string' ?
                                        (this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource : JSON.stringify((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource)),
                                    event: {
                                        ...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource ? { source: [(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchEventSource] } : {}),
                                        ...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailType ? { 'detail-type': [(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailType] } : {}),
                                        ...((this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailState ? { detail: { state: [(this.event as OFunctionLambdaCloudWatchEvent).cloudWatchDetailType] } } : {}),
                                    }
                                } : {}),
                                //cloudwatch log streams
                                ...((this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogGroup ? {
                                    logGroup: (this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogGroup,
                                    ...((this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogFilter ? { filter: (this.event as OFunctionLambdaCloudWatchLogStream).cloudWatchLogFilter } : {}),
                                } : {}),
                                //cognito triggers
                                ...((this.event as OFunctionLambdaCognitoTrigger).cognitoTrigger ? {
                                    pool: (this.event as OFunctionLambdaCognitoTrigger).cognitoUserPoolArn,
                                    trigger: (this.event as OFunctionLambdaCognitoTrigger).cognitoTrigger,
                                } : {}),
                                //http
                                ...(route ? { path: (route.path == '*' ? '{proxy+}' : route.path) } : {}),
                                ...(route ? { method: route.method } : {}),
                                ...((this.event as OFunctionLambdaHTTPEvent).cors ? { cors: (this.event as OFunctionLambdaHTTPEvent).cors } : {}),
                                ...((this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn ? {
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
    private _generateCognitoAuthorizer(): any {
        if ((this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn) {
            return {
                'Type': 'AWS::ApiGateway::Authorizer',
                'Properties': {
                    'AuthorizerResultTtlInSeconds': 300,
                    'IdentitySource': 'method.request.header.Authorization',
                    'Name': this._getAuthorizerName(),
                    'RestApiId': { 'Ref': 'ApiGatewayRestApi' },
                    'Type': 'COGNITO_USER_POOLS',
                    'ProviderARNs': [(this.event as OFunctionLambdaHTTPEvent).cognitoAuthorizerArn]
                }
            }
        } return null;
    }
    /* Naming */
    private _getProtocolName(proto: OFunctionLambdaProtocol): string {
        if (proto == OFunctionLambdaProtocol.dynamostreams) return 'stream';
        else if (proto == OFunctionLambdaProtocol.scheduler) return 'schedule';
        else if (proto == OFunctionLambdaProtocol.cloudWatch) return 'cloudwatchEvent';
        else if (proto == OFunctionLambdaProtocol.cloudWatchLogstream) return 'cloudwatchLog';
        else if (proto == OFunctionLambdaProtocol.cognito) return 'cognitoUserPool';
        return proto;
    }
    private _getFunctionName(suffix?: string): string {
        return `${this.plugin.getName()}${this.func.getName()}${this.plugin.stage}` + (suffix || '');
    }
    private _getAuthorizerName(): string {
        return this._getFunctionName('Authorizer');
    }
}