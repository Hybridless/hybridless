//Plugin
export interface OPlugin {
    functions: { [key: string]: OFunction } | { [key: string]: OFunction }[];
    disableWebpack?: boolean;
    tags?: { [key: string]: any }[]
}

//Function
export interface OFunction {
    handler: string;
    vpc?: OVPCOptions;
    timeout?: number; //Only works with lambda based
    memory?: number; //defaults to 1024
    events?: (OFunctionHTTPDTaskEvent | OFunctionProcessTaskEvent | OFunctionScheduledTaskEvent | OFunctionLambdaEvent | OFunctionLambdaContainerEvent)[];
    //ECS cluster
    ecsClusterArn?: any;
    ecsIngressSecGroupId?: string;
    enableContainerInsights?: boolean; //default is respecting account settings
    //ALB
    albListenerArn?: any;
    albIsPrivate?: boolean;
    albAdditionalTimeout?: number; //defaults to 1 second
}

//follows @hybridless/serverless-ecs-plugin model for compatibility purposes :)
export type OVPCOptions = OVPCOptions_Dedicated | OVPCOptions_Shared;
export interface OVPCOptions_Dedicated {
    cidr: string;
    subnets: string[];
};
export interface OVPCOptions_Shared {
    //Optional ivars to dictate if will use existing VPC and subnets specified
    vpcId: string;
    securityGroupIds: string[] | any;  //object allows intrinsict functions
    subnetIds: string[] | any;  //object allows intrinsict functions
    albSubnetIds?: string[] | object; //object allows intrinsict functions
};

//Types
export enum OFunctionEventType {
    //Task
    httpd = 'httpd',
    process = 'process',
    scheduledTask = 'scheduledTask',
    // agent = 'agent'
    //Serverless
    lambda = 'lambda',
    lambdaContainer = 'lambdaContainer'
};
export enum OFunctionHttpdTaskRuntime {
    nodejs10 = 'nodejs10',
    nodejs13 = 'nodejs13',
    php5 = 'php5',
    php7 = 'php7',
    container = 'container'
};
export enum OFunctionProcessTaskRuntime {
    nodejs10 = 'nodejs10',
    nodejs13 = 'nodejs13',
    container = 'container'
};
export enum OFunctionScheduledTaskRuntime {
    nodejs10 = 'nodejs10',
    nodejs13 = 'nodejs13',
    container = 'container'
};
export enum OFunctionLambdaContainerRuntime {
    nodejs10 = 'nodejs10',
    nodejs12 = 'nodejs12',
    nodejs14 = 'nodejs14',
    container = 'container'
};
export enum OFunctionLambdaProtocol {
    http = 'http',
    httpAlb = 'httpLoadBalancer',
    dynamostreams = 'dynamostreams',
    sqs = 'sqs',
    sns = 'sns',
    scheduler = 'scheduler',
    cloudWatch = 'cloudWatch',
    cloudWatchLogstream = 'cloudWatchLogstream',
    cognito = 'cognito',
    s3 = 's3',
    none = 'none'
};


/**
 ** BASE EVENTS **
**/
export interface OFunctionEvent {
    runtime: string;
    eventType: OFunctionEventType;
    handler?: string; //this, takes precende over function handler - Usefulll for multi-purpose clusters
    enabled?: boolean; //defaults to true
    memory?: number; //defaults to 1024 - takes precedence over OFunction.memory
    role?: string;
}
export interface OFunctionContainerBaseEvent extends OFunctionEvent {
    dockerFile?: string;
    entrypoint?: string; //incase of using container runtimes, you can always make custom entrypoints
    additionalDockerFiles?: [{ from: string, to: string }?];
}


/**
 ** TASK BASED **
**/
export interface OFunctionTaskBaseEvent extends OFunctionEvent, OFunctionContainerBaseEvent {
    //Service
    ec2LaunchType?: boolean; //defaults to false, if true will laucnh task into EC2
    newRelicKey?: string;//
    propagateTags?: OPropagateTagsType; //defaults to off
    placementConstraints?: { expression: string, type: 'distinctInstance' | 'memberOf' }[];
    placementStrategies?: { field: 'string', type: 'binpack' | 'random' | 'spread' }[];
    capacityProviderStrategy?: { base: number, capacityProvider: string, weight: number }[];
    //Task
    concurrency?: number; //defaults to 1
    cpu?: number; //defaults to 512
    logsMultilinePattern?: string; //defaults to '(([a-zA-Z0-9\-]* \[[a-zA-Za-]*\] )|(\[[a-zA-Za -]*\] ))'
}
export interface OFunctionEC2TaskBaseEvent extends OFunctionEvent, OFunctionContainerBaseEvent {
    ec2LaunchType?: true;
    daemonType?: boolean;
}
export interface OFunctionFargateTaskBaseEvent extends OFunctionEvent, OFunctionContainerBaseEvent {
    ec2LaunchType?: false | undefined;
}
export type OFunctionHTTPDTaskEvent = {
    runtime: OFunctionHttpdTaskRuntime; //@overwrite
    eventType: OFunctionEventType.httpd; //@overwrite
    //ALB listener layer
    routes?: {
        path: string;
        method?: string;
        priority?: number; //defaults to 1
    }[];
    cors?: {
        origin: string;
        headers: string[];
        allowCredentials: boolean;
    }
    hostname?: string | string[];
    limitSourceIPs?: string | string[];
    limitHeaders?: { name: string, value: string | string[] }[]; //optional limit headers on ALB
    port?: number; // HTTPD port (the port exposed on the container image) - If port is not specified, it will use 80 for non SSL and 443 for SSL
    certificateArns?: any[]; //certificateArn - if present it will use HTTPS
    cognitoAuthorizer?: {
        poolDomain: string;
        poolArn: any;
        clientId: string;
    };
    //health check
    healthCheckInterval?: number; //defaults to 15,
    healthCheckTimeout?: number; //defaults to 10
    healthCheckHealthyCount?: number; //defaults to 2
    healthCheckUnhealthyCount?: number; //defaults to 5
    healthCheckRoute?: string; //default will use auto generated health route
    //AS
    autoScale?: {
        min?: number; //default to 1
        max?: number; //default to 1
        metric: string;
        cooldown?: number; //defaults to 30
        cooldownIn?: number; //defaults to cooldown but has priority over it
        cooldownOut?: number; //defaults to cooldown but has priority over it
        targetValue: number;
    }
} & OFunctionTaskBaseEvent //Task base
  & (OFunctionEC2TaskBaseEvent | OFunctionFargateTaskBaseEvent);
export type OFunctionProcessTaskEvent = {
    runtime: OFunctionProcessTaskRuntime;
    eventType: OFunctionEventType.process;
} & OFunctionTaskBaseEvent //Task base
  & (OFunctionEC2TaskBaseEvent | OFunctionFargateTaskBaseEvent);
export type OFunctionScheduledTaskEvent = {
    runtime: OFunctionScheduledTaskRuntime;
    eventType: OFunctionEventType.scheduledTask;
    schedulerRate: string;
    schedulerInput?: string | object;
} & OFunctionTaskBaseEvent //Task base
  & (OFunctionEC2TaskBaseEvent | OFunctionFargateTaskBaseEvent);


/**
 ** LAMBDA BASED **
**/
export type OFunctionLambdaBaseEvent = {
    reservedConcurrency?: number;
    disableTracing?: boolean; //XRay tracing is enabled by default
    protocol: OFunctionLambdaProtocol;
}

export interface OFunctionLambdaHTTPEvent extends OFunctionEvent {
    routes: {
        path: string;
        method?: string;
    }[];
    cors?: {
        origin: string;
        headers: string[];
        allowCredentials: boolean;
    }
    protocol: OFunctionLambdaProtocol.http;
    cognitoAuthorizerArn?: any; //assumption
}
export interface OFunctionLambdaHTTPLoadBalancerEvent extends OFunctionEvent {
    routes: {
        path: string;
        method?: string | string[];
        priority?: number; //default to 1
    }[];
    cors?: {
        origin: string;
        headers: string[];
        allowCredentials: boolean;
    }
    //ALB
    protocol: OFunctionLambdaProtocol.httpAlb;
    hostname?: string | string[];
    limitSourceIPs?: string | string[];
    //todo: PR serverless to support multiple headers
    limitHeader?: { name: string, value: string | string[] }; //optional limit headers on ALB
    cognitoAuthorizer?: {
        poolDomain: string;
        poolArn: any;
        clientId: string;
    };
    //health check
    healthCheckInterval?: number; //defaults to 15,
    healthCheckTimeout?: number; //defaults to 10
    healthCheckHealthyCount?: number; //defaults to 2
    healthCheckUnhealthyCount?: number; //defaults to 5
    healthCheckRoute?: string; //required to enable health checks
}
export interface OFunctionLambdaSQSEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.sqs;
    protocolArn?: any; 
    queueBatchSize?: number; 
}
export interface OFunctionLambdaSNSEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.sns;
    protocolArn?: any; 
    filterPolicy?: object;
}
export interface OFunctionLambdaSchedulerEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.scheduler;
    schedulerRate?: string; 
    schedulerInput?: string | any; 
}
export interface OFunctionLambdaDynamoStreamsEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.dynamostreams;
    protocolArn?: any; 
}
export interface OFunctionLambdaS3Event extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.s3;
    s3bucket: string;
    s3event?: string;
    s3bucketExisting?: boolean;
    s3rules?: { [key in ('prefix'|'suffix')]?: string }[];
}
export interface OFunctionLambdaCloudWatchEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.cloudWatch;
    cloudWatchEventSource: string;
    cloudWatchDetailType: string;
    cloudWatchDetailState?: string;
    cloudWatchInput?: string | any;
}
export interface OFunctionLambdaCloudWatchLogStream extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.cloudWatchLogstream;
    cloudWatchLogGroup: string;
    cloudWatchLogFilter?: string;
}
export interface OFunctionLambdaCognitoTrigger extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.cognito;
    cognitoUserPoolArn: any;
    cognitoTrigger: string;
}
export interface OFunctionLambdaNoneEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.none;
}
//Final types
export type OFunctionLambdaEvent = {
    layers?: string[];
    eventType: OFunctionEventType.lambda;
} & OFunctionLambdaBaseEvent  //lambda base
  //Any lambda event source
  & (OFunctionLambdaHTTPEvent | OFunctionLambdaSQSEvent | OFunctionLambdaSNSEvent | 
     OFunctionLambdaSchedulerEvent | OFunctionLambdaDynamoStreamsEvent | OFunctionLambdaNoneEvent |
     OFunctionLambdaS3Event | OFunctionLambdaCloudWatchEvent | OFunctionLambdaCloudWatchLogStream |
     OFunctionLambdaCognitoTrigger | OFunctionLambdaHTTPLoadBalancerEvent);
export type OFunctionLambdaContainerEvent = {
    runtime: OFunctionLambdaContainerRuntime;
    eventType: OFunctionEventType.lambdaContainer;
} & OFunctionLambdaBaseEvent //lambda base
  & OFunctionContainerBaseEvent  //container base
  //Any lambda event source
  & (OFunctionLambdaHTTPEvent | OFunctionLambdaSQSEvent | OFunctionLambdaSNSEvent | 
     OFunctionLambdaSchedulerEvent | OFunctionLambdaDynamoStreamsEvent | OFunctionLambdaNoneEvent |
     OFunctionLambdaS3Event | OFunctionLambdaCloudWatchEvent | OFunctionLambdaCloudWatchLogStream |
     OFunctionLambdaCognitoTrigger | OFunctionLambdaHTTPLoadBalancerEvent);




//Misc
export enum OPropagateTagsType {
    OFF = 'OFF', 
    SERVICE = 'SERVICE', 
    TASK = 'TASK'
};
//Failed attempt to include servicePrincipal to IAM
// export const OIAMServicesPrincipal = {
//     type: 'array',
//     items: {
//         type: 'string'
//     },
//     maxItems: 1,
//     minItems: 0,
// };