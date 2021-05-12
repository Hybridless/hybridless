import { OFunctionProcessTaskRuntime, OFunctionHttpdTaskRuntime, OFunctionLambdaContainerRuntime } from "../options";
import BPromise = require('bluebird');
import { v4 as uuidv4 } from 'uuid';
//
export type DockerFiles = { name: string, dir: string, dest: string } [];
//
export default class Globals {
    public static PluginDefaultProvider: string = 'aws';
    //
    public static DockerLatestTag: string = 'latest';
    //Dependecies -- will be uncommented as implemented
    public static Deps_Webpack = 'serverless-webpack';
    public static Deps_ECS = '@hybridless/serverless-ecs-plugin';
    //Defaults
    public static DefaultLogsMultilinePattern = '(([a-zA-Z0-9\-]* \[[a-zA-Za-]*\] )|(\[[a-zA-Za -]*\] ))';
    public static DefaultHealthCheckInterval = 15;
    public static DefaultHealthCheckTimeout = 10;
    public static DefaultHealthCheckHealthyCount = 2;
    public static DefaultHealthCheckUnhealthCount = 5;
    public static DefaultLoadBalancerAdditionalTimeout = 1;

    //HTTPD stuff
        public static HTTPD_DefaultMemory = 1024;
        public static HTTPD_DefaultCPU = 512;
        public static HTTPD_DefaultTimeout = 30;
        public static HTTPD_DefaultConcurrency = 2;
        public static HTTPD_ImageByRuntime(environment: OFunctionHttpdTaskRuntime): string {
            if (environment == OFunctionHttpdTaskRuntime.nodejs10) {
                return 'task-httpd/Dockerfile-Httpd-Nodejs10'
            } else if (environment == OFunctionHttpdTaskRuntime.nodejs13) {
                return 'task-httpd/Dockerfile-Httpd-Nodejs13'
            } else if (environment == OFunctionHttpdTaskRuntime.php5) {
                return 'task-httpd/Dockerfile-Httpd-PHP5'
            } else if (environment == OFunctionHttpdTaskRuntime.php7) {
                return 'task-httpd/Dockerfile-Httpd-PHP7'
            } throw new Error(`Unknown Httpd environment ${environment}, can't continue!`);
        }
        public static HTTPD_HealthCheckByRuntime(environment: OFunctionHttpdTaskRuntime): string {
            if (environment == OFunctionHttpdTaskRuntime.nodejs10 || environment == OFunctionHttpdTaskRuntime.nodejs13) {
                return `/healthCheck/${uuidv4()}`;
            } throw new Error(`Unknown Httpd environment ${environment}, can't continue!`);
        }
    //Process stuff
        public static Process_DefaultMemory = 1024;
        public static Process_DefaultCPU = 512;
        public static Process_DefaultConcurrency = 1;
        public static Process_ImageByRuntime(environment: OFunctionProcessTaskRuntime): string {
            if (environment == OFunctionProcessTaskRuntime.nodejs10) {
                return 'task-process/Dockerfile-Process-Nodejs10'
            } else if (environment == OFunctionProcessTaskRuntime.nodejs13) {
                return 'task-process/Dockerfile-Process-Nodejs13'
            } throw new Error(`Unknown process environment ${environment}, can't continue!`);
        }
    //Lambda Container stuff
        public static LambdaContainer_DefaultMemory = 1024;
        public static LambdaContainer_DefaultCPU = 512;
        public static LambdaContainer_DefaultConcurrency = 1;
        public static LambdaContainer_ImageByRuntime(environment: OFunctionLambdaContainerRuntime): string {
            if (environment == OFunctionLambdaContainerRuntime.nodejs10) {
                return 'lambda-container/Dockerfile-LambdaContainer-Nodejs10'
            } else if (environment == OFunctionLambdaContainerRuntime.nodejs12) {
                return 'lambda-container/Dockerfile-LambdaContainer-Nodejs12';
            } throw new Error(`Unknown process environment ${environment}, can't continue!`);
        }


    //Utils - Candidate
    public static Sleep(delay): BPromise {
        return new BPromise((resolve) => setTimeout(resolve, delay));
    }

}