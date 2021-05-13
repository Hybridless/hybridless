//Plugin
export interface OPlugin {
    functions: { [key: string]: OFunction } | { [key: string]: OFunction }[];
    disableWebpack?: boolean;
    tags?: string[];
}
//Function
export interface OFunction {
    handler: string;
    vpc?: OVPCOptions;
    timeout?: number; //Only works with lambda based
    memory?: number; //defaults to 1024
    events?: (OFunctionHTTPDTaskEvent | OFunctionProcessTaskEvent | OFunctionLambdaEvent | OFunctionLambdaContainerEvent)[];
    //ECS cluster
    ecsClusterArn?: string;
    ecsIngressSecGroupId?: string;
    //ALB
    albListenerArn?: string;
    additionalALBTimeout?: number; //default to 1 second
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
    securityGroupIds: string[];
    subnetIds: string[];
};

//Types
export enum OFunctionEventType {
    //Task
    httpd = 'httpd',
    process = 'process',
    // schedulerTask = 'schedulerTask',
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
};
export enum OFunctionProcessTaskRuntime {
    nodejs10 = 'nodejs10',
    nodejs13 = 'nodejs13',
};
export enum OFunctionLambdaContainerRuntime {
    nodejs10 = 'nodejs10',
    nodejs12 = 'nodejs12',
    nodejs14 = 'nodejs14',
};
export enum OFunctionLambdaProtocol {
    http = 'http',
    dynamostreams = 'dynamostreams',
    sqs = 'sqs',
    sns = 'sns',
    scheduler = 'scheduler',
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
    additionalDockerFiles?: [{ from: string, to: string }?];
}


/**
 ** TASK BASED **
**/
export interface OFunctionTaskBaseEvent extends OFunctionEvent, OFunctionContainerBaseEvent {
    //Service
    ec2LaunchType?: boolean; //defaults to false, if true will laucnh task into EC2
    newRelicKey?: string;//
    //Task
    concurrency?: number; //defaults to 1
    cpu?: number; //defaults to 512
    logsMultilinePattern?: string; //defaults to '(([a-zA-Z0-9\-]* \[[a-zA-Za-]*\] )|(\[[a-zA-Za -]*\] ))'
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
}
export interface OFunctionHTTPDTaskEvent extends OFunctionTaskBaseEvent {
    runtime: OFunctionHttpdTaskRuntime; //@overwrite
    eventType: OFunctionEventType.httpd; //@overwrite
    //ALB listener layer
    routes?: {
        path: string;
        method: string;
    }[];
    cors?: {
        origin: string;
        headers: string[];
        allowCredentials: boolean;
    }
    hostname?: string | string[];
    limitSourceIPs?: string | string[];
    priority?: number; //Router priority, usefull for leaving wildcard routes to be the last resort
    port?: number; // HTTPD port (the port exposed on the container image) - if not specified random port will be used - usefull for busy private subnets - If port is not specified, it will use 80 for non SSL and 443 for SSL
    certificateArns?: string[]; //certificateArn - if present it will use HTTPS
    cognitoAuthorizer?: {
        poolDomain: string;
        poolArn: string;
        clientId: string;
    };
    //health check
    healthCheckInterval?: number; //defaults to 15,
    healthCheckTimeout?: number; //defaults to 10
    healthCheckHealthyCount?: number; //defaults to 2
    healthCheckUnhealthyCount?: number; //defaults to 5
}
export interface OFunctionProcessTaskEvent extends OFunctionTaskBaseEvent {
    ec2LaunchType?: boolean; //defaults to false, if true will laucnh task into EC2
    runtime: OFunctionProcessTaskRuntime;
    eventType: OFunctionEventType.process;
}


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
        method: string;
    }[];
    cors?: {
        origin: string;
        headers: string[];
        allowCredentials: boolean;
    }
    protocol: OFunctionLambdaProtocol.http;
    cognitoAuthorizerArn?: string; //assumption
}
export interface OFunctionLambdaSQSEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.sqs;
    prototocolArn?: any; 
    queueBatchSize?: number; 
}
export interface OFunctionLambdaSNSEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.sns;
    prototocolArn?: any; 
    filterPolicy?: object;
}
export interface OFunctionLambdaSchedulerEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.scheduler;
    schedulerRate?: string; 
    schedulerInput?: string; 
}
export interface OFunctionLambdaDynamoStreamsEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.dynamostreams;
    prototocolArn?: any; 
}
export interface OFunctionLambdaNoneEvent extends OFunctionEvent {
    protocol: OFunctionLambdaProtocol.none;
}
//Final types
export type OFunctionLambdaEvent = {
    layers?: string[];
    eventType: OFunctionEventType.lambda;
} & OFunctionLambdaBaseEvent & (OFunctionLambdaHTTPEvent | OFunctionLambdaSQSEvent | OFunctionLambdaSNSEvent | OFunctionLambdaSchedulerEvent | OFunctionLambdaDynamoStreamsEvent | OFunctionLambdaNoneEvent);
export type OFunctionLambdaContainerEvent = {
    runtime: OFunctionLambdaContainerRuntime;
    eventType: OFunctionEventType.lambdaContainer;
} & OFunctionLambdaBaseEvent & OFunctionContainerBaseEvent & (OFunctionLambdaHTTPEvent | OFunctionLambdaSQSEvent | OFunctionLambdaSNSEvent | OFunctionLambdaSchedulerEvent | OFunctionLambdaDynamoStreamsEvent | OFunctionLambdaNoneEvent);

