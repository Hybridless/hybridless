import { FunctionBaseEvent } from "./FunctionBaseEvent"; //base class
//
import Hybridless = require("../..");
import { Function } from "../Function";
import { OFunctionContainerReusableImage, OFunctionContainerBaseEvent, OFunctionEventType } from "../../options";
//
import BPromise = require('bluebird');
import util = require('util');
import child = require('child_process');
import { DockerFiles } from "../../core/Globals";
import { Image } from "../Image";
//
const executor = util.promisify(child.exec);
//
export class FunctionContainerBaseEvent extends FunctionBaseEvent<OFunctionContainerBaseEvent> {
  private readonly currentTag: string;
  private readonly unifiedEventsContainer: boolean;
  private readonly usesReusableImages: boolean;
  public image: Image;
  // (OFunctionContainerOptionalImage | OFunctionContainerReusableImage)
  public constructor(plugin: Hybridless, func: Function, event: OFunctionContainerBaseEvent, index: number, unifiedEventsContainer?: boolean) {
    super(plugin, func, event, index);
    this.unifiedEventsContainer = unifiedEventsContainer;
    this.currentTag = Date.now() + '';
    this.usesReusableImages = !!(<OFunctionContainerReusableImage>this.event)?.imageId;
  }

  //Plugin function lifecycle
  public async spread(): BPromise { 
    //
    if (this.usesReusableImages) {
      this.image = this.plugin.getImageById((<OFunctionContainerReusableImage>this.event)?.imageId)
    } else {
      const files = this.getContainerFiles()
      const dockerFile = files.find((f) => f.dest == 'Dockerfile')
      this.image = new Image(this.plugin, {
        dockerFile: dockerFile.name,
        additionalDockerFiles: files.filter((f) => f.dest != 'Dockerfile')
                                    .map((f) => ({from: f.name, to: f.dest, path: f.dir})),
        dockerBuildArgs: this.getContainerBuildArgs()
      }, this.getImageName(), dockerFile.dir)
    }
    return BPromise.resolve(); 
  }
  public async checkDependencies(): BPromise {
    return new BPromise(async (resolve, reject) => {
      if (this.event.runtime && this.event.runtime.toLowerCase().indexOf('java') != -1) this.plugin.depManager.enableMvn();
      if (this.event.runtime && this.event.runtime.toLowerCase().indexOf('go') != -1) this.plugin.depManager.enableGo();
      if (this.event.runtime && this.event.runtime.toLowerCase().indexOf('node') != -1 && !this.plugin.options.disableWebpack) this.plugin.depManager.enableWebpack();
      if (this.event.eventType != OFunctionEventType.lambda && this.event.eventType != OFunctionEventType.lambdaContainer) {
        this.plugin.depManager.enableECSPlugin();
      }
      if (this.event.eventType != OFunctionEventType.job) {
        this.plugin.depManager.enableECSRolePermission();
      }
      resolve();
    });
  }
  public async createRequiredResources(): BPromise {
    // Check for unified build
    if (this.unifiedEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    // 
    if (!this.usesReusableImages) return this.image.createRequiredResources();
    else return BPromise.resolve()
  }
  public async build(): BPromise {
    // Check for unified build
    if (this.unifiedEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    // 
    if (!this.usesReusableImages) return this.image.build();
    else return BPromise.resolve()
  }
  public async push(): BPromise {
    // Check for unified build
    if (this.unifiedEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    // 
    if (!this.usesReusableImages) return this.image.push();
    else return BPromise.resolve()
  }
  public async cleanup(soft?: boolean): BPromise {
    // Check for unified build
    if (this.unifiedEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    // 
    if (!this.usesReusableImages) return this.image.cleanup(soft);
    else return BPromise.resolve()
  }
  public async delete(): BPromise {
    // Check for unified build
    if (this.unifiedEventsContainer && this.index != 0) {
      return BPromise.resolve();
    }
    // 
    if (!this.usesReusableImages) return this.image.delete();
    else return BPromise.resolve()
  }

  //subclasses support
  protected getContainerFiles(): DockerFiles { return null; }
  protected getContainerBuildArgs(): { [key: string]: string } | null { return null; }
  // protected getContainerEnvironments(): any { return {}; }
  public async getClusterTask(): BPromise { return BPromise.resolve(); }

  //Private
  private getImageName(): string {
    return `${this.func.getName()}.${this.unifiedEventsContainer ? 0 : this.index}`.toLowerCase();
  }
  protected getTaskName(): string {
    return this.plugin.provider.naming.getNormalizedFunctionName(`Task${this.index}`);
  }
}