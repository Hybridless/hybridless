import { OFunctionProcessTaskRuntime, OFunctionScheduledTaskRuntime, OFunctionBatchJobRuntime, OFunctionHttpdTaskRuntime, OFunctionLambdaContainerRuntime } from "../options";
import BPromise = require('bluebird');
import { v4 as uuidv4 } from 'uuid';
//
export type DockerFiles = { name: string, dir: string, dest: string }[];
//
export default class Globals {
  public static PluginDefaultProvider: string = 'aws';
  public static DockerLatestTag: string = 'latest';
  public static DockerPreDeploymentTag: string = 'previous';
  //Dependecies
  public static Deps_Webpack = 'serverless-webpack';
  public static Deps_ECS = '@hybridless/serverless-ecs-plugin';
  public static Deps_LambdaLogsRetention  = 'serverless-plugin-log-retention';
  //Java support
  public static Mvn_Build_Command = 'mvn clean install';
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
    } else if (environment == OFunctionHttpdTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`);
    } throw new Error(`Unknown event *httpd* environment type! ${environment} is not a valid environment, can't continue!`);
  }
  public static HTTPD_HealthCheckByRuntime(environment: OFunctionHttpdTaskRuntime): string {
    return `/healthCheck/${uuidv4()}`
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
    } else if (environment == OFunctionProcessTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`);
    } throw new Error(`Unknown event *process* environment type! ${environment} is not a valid environment, can't continue!`);
  }
  //Scheduled stuff
  public static Scheduled_DefaultMemory = 1024;
  public static Scheduled_DefaultCPU = 512;
  public static Scheduled_DefaultConcurrency = 1;
  public static Scheduled_ImageByRuntime(environment: OFunctionScheduledTaskRuntime): string {
    if (environment == OFunctionScheduledTaskRuntime.nodejs10) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs10'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs13) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs13'
    } else if (environment == OFunctionScheduledTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`);
    } throw new Error(`Unknown event *scheduled* environment type! ${environment} is not a valid environment, can't continue!`);
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
    } else if (environment == OFunctionLambdaContainerRuntime.java11) {
      return 'lambda-container/Dockerfile-LambdaContainer-Java11';
    } else if (environment == OFunctionLambdaContainerRuntime.java8) {
      return 'lambda-container/Dockerfile-LambdaContainer-Java8';
    } else if (environment == OFunctionLambdaContainerRuntime.java8al12) {
      return 'lambda-container/Dockerfile-LambdaContainer-Java8al12';
    } throw new Error(`Unknown event *process* environment type! ${environment} is not a valid environment, can't continue!`);
  }
  //Batch job stuff
  public static BatchJob_DefaultAttempts = 1;
  public static BatchJob_ImageByRuntime(environment: OFunctionBatchJobRuntime): string {
    if (environment == OFunctionBatchJobRuntime.nodejs10) {
      return 'job-batch/Dockerfile-Job-Nodejs10'
    } else if (environment == OFunctionBatchJobRuntime.nodejs12) {
      return 'job-batch/Dockerfile-Job-Nodejs12';
    } else if (environment == OFunctionBatchJobRuntime.nodejs14) {
      return 'job-batch/Dockerfile-Job-Nodejs14';
    } throw new Error(`Unknown event *process* environment type! ${environment} is not a valid environment, can't continue!`);
  }
}