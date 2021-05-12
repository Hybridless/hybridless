//follows serverless-fargate-plugin model for compatibility purposes :)
export interface OVPCOptions {
    cidr: string;
    subnets: string[];
    //Optional ivars to dictate if will use existing VPC 
    //and subnets specified
    vpcId: string;
    securityGroupIds: string[];
    subnetIds: string[];
}

//Types
export enum OFunctionEventType {
    httpd = 'httpd',
    lambda = 'lambda',
    process = 'process',
    lambdaContainer = 'lambdaContainer'
};
export enum OFunctionHttpdRuntime {
    nodejs10 = 'nodejs10',
    nodejs13 = 'nodejs13',
    php5 = 'php5',
    php7 = 'php7',
};
export enum OFunctionContainerRuntime {
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

//Events
export interface OFunctionEvent {
    eventType: OFunctionEventType;
    handler?: string; //this, takes precende over function handler - Usefulll for multi-purpose clusters
    enabled?: boolean; //defaults to true

    memory?: number; //defaults to 1024 - takes precedence over OFunction.memory
    role?: string;
}

//Container
export interface OFunctionTaskBaseEvent extends OFunctionEvent {
    dockerFile?: string;
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
    runtime?: OFunctionHttpdRuntime;
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
    runtime?: OFunctionContainerRuntime;
    dockerFile?: string;
}

//Lambda Events
export interface OFunctionLambdaBaseEvent extends OFunctionEvent {
    routes?: {
        path: string;
        method: string;
    }[];
    cors?: {
        origin: string;
        headers: string[];
        allowCredentials: boolean;
    }
    protocol?: OFunctionLambdaProtocol; //defaults to HTTP 
    prototocolArn?: any; //Only used when protocol is dynamostreams or sqs
    queueBatchSize?: number; //Only used when protocol is sqs
    schedulerRate?: string; //Only used when protocol is scheduler
    schedulerInput?: string; //Only used when protocol is scheduler
    reservedConcurrency?: number;
    cognitoAuthorizerArn?: string;
    disableTracing?: boolean; //XRay tracing is enabled by default
    filterPolicy?: object;
}
export interface OFunctionLambdaEvent extends OFunctionLambdaBaseEvent {
    runtime?: string;
    layers?: string[];
}
export interface OFunctionLambdaContainerEvent extends OFunctionLambdaBaseEvent {
    runtime?: OFunctionLambdaContainerRuntime;
    dockerFile?: string;
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
}
//Plugin
export interface OPlugin {
    functions?: { key?: OFunction };
    tags: string[];
}
