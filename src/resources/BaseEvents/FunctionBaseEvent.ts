import Hybridless = require("../..");
import { BaseFunction } from "../Function";
import { OFunctionEventType, OFunctionEvent } from "../../options";
//
import BPromise = require('bluebird');
//
export abstract class FunctionBaseEvent <T> {
    protected readonly plugin: Hybridless;
    protected readonly func: BaseFunction;
    public readonly event: T;
    protected readonly index: number;
    public readonly eventType: OFunctionEventType;
    //
    public constructor(plugin: Hybridless, func: BaseFunction, event: T, index: number) {
        this.plugin = plugin;
        this.func = func;
        this.event = event;
        this.index = index;
        this.eventType = event['eventType'];
    }
    //Plugin life cycle - ordered by calling order
    public abstract spread(): BPromise; //1
    public abstract checkDependencies(): BPromise; //2
    public abstract createRequiredResources(): BPromise; //3
    public abstract build(): BPromise; //4
    public abstract push(): BPromise; //5
    //Helper
    public isEnabled(): boolean {
        const e = <OFunctionEvent><unknown>this.event;
        return (e.enabled == undefined || e.enabled == true);
    }
}
