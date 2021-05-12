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
        private static _HTTPD_ImageByRuntime(environment: OFunctionHttpdTaskRuntime): string {
            if (environment == OFunctionHttpdTaskRuntime.nodejs10) {
                return 'Dockerfile-Httpd-Nodejs10'
            } else if (environment == OFunctionHttpdTaskRuntime.nodejs13) {
                return 'Dockerfile-Httpd-Nodejs13'
            } else if (environment == OFunctionHttpdTaskRuntime.php5) {
                return 'Dockerfile-Httpd-PHP5'
            } else if (environment == OFunctionHttpdTaskRuntime.php7) {
                return 'Dockerfile-Httpd-PHP7'
            } throw new Error(`Unknown Httpd environment ${environment}, can't continue!`);
        }
        public static HTTPD_DockerFilesByRuntime(environment: OFunctionHttpdTaskRuntime, serverlessDir: string, handler: string, healthCheckRoute: string, customDockerFile?: string): DockerFiles {
            const dockerFileName = Globals._HTTPD_ImageByRuntime(environment);
            //
            let safeDir: any = __dirname.split('/');
            safeDir.splice(safeDir.length - 1, 1);
            safeDir = safeDir.join('/');
            //Nodejs Specific
            if (environment == OFunctionHttpdTaskRuntime.nodejs10 || environment == OFunctionHttpdTaskRuntime.nodejs13) {
                return [
                (customDockerFile ? 
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: dockerFileName, dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
                    { name: 'Index-Httpd-NodejsX', dir: safeDir + '/resources/assets', dest: 'proxy.js' },
                    { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }
                ];
            } else { //assume php cause `_HTTPD_ImageByRuntime` call above throws if none of then
                //get handler path and remove index.php 
                const handleRootFolder = (handler.indexOf('.php') != -1 ? handler.split('/').splice(0, handler.split('/').length - 1).join('/') : handler);
                return [
                (customDockerFile ? 
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: dockerFileName, dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
                    { name: 'healthCheck.php', dir: safeDir + '/resources/assets', dest: `/app/${healthCheckRoute}` },
                    { name: handleRootFolder, dir: serverlessDir, dest: '/app/' }
                ];
            }
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
        public static _Process_ImageByRuntime(environment: OFunctionProcessTaskRuntime): string {
            if (environment == OFunctionProcessTaskRuntime.nodejs10) {
                return 'Dockerfile-Process-Nodejs10'
            } else if (environment == OFunctionProcessTaskRuntime.nodejs13) {
                return 'Dockerfile-Process-Nodejs13'
            } throw new Error(`Unknown process environment ${environment}, can't continue!`);
        }
        public static Process_DockerFilesByRuntime(environment: OFunctionProcessTaskRuntime, serverlessDir: string, customDockerFile?: string): DockerFiles {
            const dockerFileName = Globals._Process_ImageByRuntime(environment);
            //
            let safeDir: any = __dirname.split('/');
            safeDir.splice(safeDir.length - 1, 1);
            safeDir = safeDir.join('/');
            //
            return [
                (customDockerFile ?
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: dockerFileName, dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
                { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }
            ];
        }
    //Lambda Container stuff
        public static LambdaContainer_DefaultMemory = 1024;
        public static LambdaContainer_DefaultCPU = 512;
        public static LambdaContainer_DefaultConcurrency = 1;
        public static _LambdaContainer_ImageByRuntime(environment: OFunctionLambdaContainerRuntime): string {
            if (environment == OFunctionLambdaContainerRuntime.nodejs10) {
                return 'Dockerfile-LambdaContainer-Nodejs10'
            } else if (environment == OFunctionLambdaContainerRuntime.nodejs12) {
                return 'Dockerfile-LambdaContainer-Nodejs12';
            } throw new Error(`Unknown process environment ${environment}, can't continue!`);
        }
        public static LambdaContainer_DockerFilesByRuntime(environment: OFunctionLambdaContainerRuntime, serverlessDir: string, customDockerFile?: string): DockerFiles {
            const dockerFileName = Globals._LambdaContainer_ImageByRuntime(environment);
            //
            let safeDir: any = __dirname.split('/');
            safeDir.splice(safeDir.length - 1, 1);
            safeDir = safeDir.join('/');
            //
            return [
                (customDockerFile ? 
                    { name: customDockerFile, dir: serverlessDir, dest: 'Dockerfile' } :
                    { name: dockerFileName, dir: safeDir + '/resources/assets', dest: 'Dockerfile' }),
                { name: '.webpack/service', dir: serverlessDir, dest: '/usr/src/app' }
            ];
        }

    //Utils - Candidate
    public static Sleep(delay): BPromise {
        return new BPromise((resolve) => setTimeout(resolve, delay));
    }

}