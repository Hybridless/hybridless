import {
  OFunctionProcessTaskRuntime,
  OFunctionLaunchableTaskRuntime,
  OFunctionScheduledTaskRuntime,
  OFunctionBatchJobRuntime,
  OFunctionHttpdTaskRuntime,
  OFunctionLambdaContainerRuntime,
} from '../options'
import BPromise = require('bluebird')
import { v4 as uuidv4 } from 'uuid'
//
export type DockerFiles = { name: string; dir: string; dest: string }[]
//
export default class Globals {
  public static PluginDefaultProvider: string = 'aws'
  public static DockerLatestTag: string = 'latest'
  public static DockerPreDeploymentTag: string = 'previous'
  public static BuildDefaultConcurrency: number = 10
  //Dependecies
  public static Deps_Webpack = 'serverless-webpack'
  public static Deps_ECS = '@hybridless/serverless-ecs-plugin'
  public static Deps_LambdaLogsRetention = '@hybridless/serverless-plugin-log-retention'
  public static Deps_LambdaProvisionedConcurrencyAutoscaling =
    'serverless-provisioned-concurrency-autoscaling'
  //Java support
  public static Mvn_Build_Command = 'mvn clean install'
  public static Go_Build_Command = 'go mod tidy && go build -o ./build/'
  //Defaults
  public static DefaultLogsMultilinePattern = '(([a-zA-Z0-9-]* [[a-zA-Za-]*] )|([[a-zA-Za -]*] ))'
  public static DefaultHealthCheckInterval = 15
  public static DefaultHealthCheckTimeout = 10
  public static DefaultHealthCheckHealthyCount = 2
  public static DefaultHealthCheckUnhealthCount = 5
  public static DefaultHealthCheckStatusCode = 200
  public static DefaultLoadBalancerAdditionalTimeout = 1
  public static DefaultLogRetetionInDays = 90
  //HTTPD stuff
  public static HTTPD_DefaultMemory = 1024
  public static HTTPD_DefaultCPU = 512
  public static HTTPD_DefaultTimeout = 30
  public static HTTPD_DefaultConcurrency = 2
  public static HTTPD_ImageByRuntime(environment: OFunctionHttpdTaskRuntime): string {
    if (environment == OFunctionHttpdTaskRuntime.nodejs10) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs10'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs13) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs13'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs14) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs14'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs16) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs16'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs18) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs18'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs20) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs20'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs22) {
      return 'task-httpd/Dockerfile-Httpd-Nodejs22'
    } else if (environment == OFunctionHttpdTaskRuntime.php5) {
      return 'task-httpd/Dockerfile-Httpd-PHP5'
    } else if (environment == OFunctionHttpdTaskRuntime.php7) {
      return 'task-httpd/Dockerfile-Httpd-PHP7'
    } else if (environment == OFunctionHttpdTaskRuntime.go) {
      return 'task-httpd/Dockerfile-Httpd-Go'
    } else if (environment == OFunctionHttpdTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`)
    }
    throw new Error(
      `Unknown event *httpd* environment type! ${environment} is not a valid environment, can't continue!`
    )
  }
  public static HTTPD_EntrypointByRuntime(environment: OFunctionHttpdTaskRuntime): string {
    if (
      environment == OFunctionHttpdTaskRuntime.nodejs10 ||
      environment == OFunctionHttpdTaskRuntime.nodejs13 ||
      environment == OFunctionHttpdTaskRuntime.nodejs14 ||
      environment == OFunctionHttpdTaskRuntime.nodejs16
    ) {
      return 'task-httpd/Index-Httpd-NodejsX'
    } else if (environment == OFunctionHttpdTaskRuntime.nodejs18) {
      return 'task-httpd/Index-Httpd-NodejsESM'
    }
    throw new Error(
      `Unknown event *httpd* environment type for entrypoint! ${environment} is not a valid environment, can't continue!`
    )
  }
  public static HTTPD_HealthCheckByRuntime(environment: OFunctionHttpdTaskRuntime): string {
    return `/healthCheck/${uuidv4()}`
  }
  //Process stuff
  public static Process_DefaultMemory = 1024
  public static Process_DefaultCPU = 512
  public static Process_DefaultConcurrency = 1
  public static Process_ImageByRuntime(environment: OFunctionProcessTaskRuntime): string {
    if (environment == OFunctionProcessTaskRuntime.nodejs10) {
      return 'task-process/Dockerfile-Process-Nodejs10'
    } else if (environment == OFunctionProcessTaskRuntime.nodejs13) {
      return 'task-process/Dockerfile-Process-Nodejs13'
    } else if (environment == OFunctionProcessTaskRuntime.nodejs14) {
      return 'task-process/Dockerfile-Process-Nodejs14'
    } else if (environment == OFunctionProcessTaskRuntime.nodejs16) {
      return 'task-process/Dockerfile-Process-Nodejs16'
    } else if (environment == OFunctionProcessTaskRuntime.nodejs18) {
      return 'task-process/Dockerfile-Process-Nodejs18'
    } else if (environment == OFunctionProcessTaskRuntime.nodejs20) {
      return 'task-process/Dockerfile-Process-Nodejs20'
    } else if (environment == OFunctionProcessTaskRuntime.nodejs22) {
      return 'task-process/Dockerfile-Process-Nodejs22'
    } else if (environment == OFunctionProcessTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`)
    }
    throw new Error(
      `Unknown event *process* environment type! ${environment} is not a valid environment, can't continue!`
    )
  }
  //Scheduled stuff
  public static Scheduled_DefaultMemory = 1024
  public static Scheduled_DefaultCPU = 512
  public static Scheduled_DefaultConcurrency = 1
  public static Scheduled_ImageByRuntime(environment: OFunctionScheduledTaskRuntime): string {
    if (environment == OFunctionScheduledTaskRuntime.nodejs10) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs10'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs13) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs13'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs14) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs14'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs16) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs16'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs18) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs18'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs20) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs20'
    } else if (environment == OFunctionScheduledTaskRuntime.nodejs22) {
      return 'task-scheduled/Dockerfile-Scheduler-Nodejs22'
    } else if (environment == OFunctionScheduledTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`)
    }
    throw new Error(
      `Unknown event *scheduled* environment type! ${environment} is not a valid environment, can't continue!`
    )
  }
  //Launchable stuff
  public static Launchable_DefaultMemory = 1024
  public static Launchable_DefaultCPU = 512
  public static Launchable_DefaultConcurrency = 1
  public static Launchable_ImageByRuntime(environment: OFunctionLaunchableTaskRuntime): string {
    if (environment == OFunctionLaunchableTaskRuntime.nodejs10) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs10'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs13) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs13'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs14) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs14'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs16) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs16'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs18) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs18'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs20) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs20'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs22) {
      return 'task-launchable/Dockerfile-Launchable-Nodejs22'
    } else if (environment == OFunctionLaunchableTaskRuntime.container) {
      throw new Error(`Container environments requires dockerFile to be set!`)
    }
    throw new Error(
      `Unknown event *launchable* environment type! ${environment} is not a valid environment, can't continue!`
    )
  }
  public static Launchable_EntrypointByRuntime(
    environment: OFunctionLaunchableTaskRuntime
  ): string {
    if (
      environment == OFunctionLaunchableTaskRuntime.nodejs10 ||
      environment == OFunctionLaunchableTaskRuntime.nodejs13 ||
      environment == OFunctionLaunchableTaskRuntime.nodejs14 ||
      environment == OFunctionLaunchableTaskRuntime.nodejs16
    ) {
      return 'task-launchable/Index-Launchable-NodejsX'
    } else if (environment == OFunctionLaunchableTaskRuntime.nodejs18) {
      return 'task-launchable/Index-Launchable-NodejsESM'
    }
    throw new Error(
      `Unknown event *launchable* environment type for entrypoint! ${environment} is not a valid environment, can't continue!`
    )
  }
  //Lambda Container stuff
  public static LambdaContainer_DefaultMemory = 1024
  public static LambdaContainer_DefaultCPU = 512
  public static LambdaContainer_DefaultConcurrency = 1
  public static LambdaContainer_ImageByRuntime(
    environment: OFunctionLambdaContainerRuntime
  ): string {
    if (environment == OFunctionLambdaContainerRuntime.nodejs10) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs10'
    } else if (environment == OFunctionLambdaContainerRuntime.nodejs12) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs12'
    } else if (environment == OFunctionLambdaContainerRuntime.nodejs14) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs14'
    } else if (environment == OFunctionLambdaContainerRuntime.nodejs16) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs16'
    } else if (environment == OFunctionLambdaContainerRuntime.nodejs18) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs18'
    } else if (environment == OFunctionLambdaContainerRuntime.nodejs20) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs20'
    } else if (environment == OFunctionLambdaContainerRuntime.nodejs22) {
      return 'lambda-container/Dockerfile-LambdaContainer-Nodejs22'
    } else if (environment == OFunctionLambdaContainerRuntime.java11) {
      return 'lambda-container/Dockerfile-LambdaContainer-Java11'
    } else if (environment == OFunctionLambdaContainerRuntime.java8) {
      return 'lambda-container/Dockerfile-LambdaContainer-Java8'
    } else if (environment == OFunctionLambdaContainerRuntime.java8al12) {
      return 'lambda-container/Dockerfile-LambdaContainer-Java8al12'
    }
    throw new Error(
      `Unknown event *process* environment type! ${environment} is not a valid environment, can't continue!`
    )
  }
  //Batch job stuff
  public static BatchJob_DefaultAttempts = 1
  public static BatchJob_ImageByRuntime(environment: OFunctionBatchJobRuntime): string {
    if (environment == OFunctionBatchJobRuntime.nodejs10) {
      return 'job-batch/Dockerfile-Job-Nodejs10'
    } else if (environment == OFunctionBatchJobRuntime.nodejs12) {
      return 'job-batch/Dockerfile-Job-Nodejs12'
    } else if (environment == OFunctionBatchJobRuntime.nodejs14) {
      return 'job-batch/Dockerfile-Job-Nodejs14'
    } else if (environment == OFunctionBatchJobRuntime.nodejs16) {
      return 'job-batch/Dockerfile-Job-Nodejs16'
    } else if (environment == OFunctionBatchJobRuntime.nodejs18) {
      return 'job-batch/Dockerfile-Job-Nodejs18'
    } else if (environment == OFunctionBatchJobRuntime.nodejs20) {
      return 'job-batch/Dockerfile-Job-Nodejs20'
    } else if (environment == OFunctionBatchJobRuntime.nodejs22) {
      return 'job-batch/Dockerfile-Job-Nodejs22'
    } else if (environment == OFunctionBatchJobRuntime.java11) {
      return 'job-batch/Dockerfile-Job-Java11'
    } else if (environment == OFunctionBatchJobRuntime.java8) {
      return 'job-batch/Dockerfile-Job-Java8'
    } else if (environment == OFunctionBatchJobRuntime.java8al12) {
      return 'job-batch/Dockerfile-Job-Java8al12'
    }
    throw new Error(
      `Unknown event *job* environment type! ${environment} is not a valid environment, can't continue!`
    )
  }
  public static BatchJob_EntrypointByRuntime(environment: OFunctionBatchJobRuntime): string {
    if (
      environment == OFunctionBatchJobRuntime.nodejs10 ||
      environment == OFunctionBatchJobRuntime.nodejs12 ||
      environment == OFunctionBatchJobRuntime.nodejs14 ||
      environment == OFunctionBatchJobRuntime.nodejs16
    ) {
      return 'job-batch/Index-Job-NodejsX'
    } else if (
      environment == OFunctionBatchJobRuntime.nodejs18 ||
      environment == OFunctionBatchJobRuntime.nodejs20 ||
      environment == OFunctionBatchJobRuntime.nodejs22
    ) {
      return 'job-batch/Index-Job-NodejsESM'
    }
    throw new Error(
      `Unknown event *job* environment type for entrypoint! ${environment} is not a valid environment, can't continue!`
    )
  }
}
