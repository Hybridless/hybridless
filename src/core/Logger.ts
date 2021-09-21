import stackTrace = require('stack-trace');
import stringify = require('json-stringify-safe');
//
export const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
enum LOG_STRINGS { 'DEBUG', 'INFO', 'WARN', 'ERROR' };
//
export default class Logger {
  private readonly _LOG_LEVEL: any;
  private _logs: any[];
  private readonly serverless: any;
  constructor(serverless: any, _LOG_LEVEL: any) {
    if (!_LOG_LEVEL) _LOG_LEVEL = LOG_LEVELS.DEBUG;
    else {
      //@ts-ignore
      _LOG_LEVEL = Object.values(LOG_STRINGS).indexOf(_LOG_LEVEL);
      if (_LOG_LEVEL == -1) _LOG_LEVEL = LOG_LEVELS.DEBUG;
    }
    //
    this.serverless = serverless;
    this._LOG_LEVEL = _LOG_LEVEL;
  }

  //Public
  debug(...args: any[]) { this._processLog(LOG_LEVELS.DEBUG, args); }
  log(...args: any[]) { this._processLog(LOG_LEVELS.INFO, args); }
  info(...args: any[]) { this._processLog(LOG_LEVELS.INFO, args); }
  warning(...args: any[]) { this._processLog(LOG_LEVELS.WARN, args); }
  warn(...args: any[]) { this._processLog(LOG_LEVELS.WARN, args); }
  error(...args: any[]) { this._processLog(LOG_LEVELS.ERROR, args); }
  exception(exception) {
    //format message
    let msg = [];
    //push exeception
    msg.push(exception + " -");
    //get args
    for (let arg of arguments) if (arg != exception) msg.push(arg);
    msg.push(exception.stack); //push exeception stack at the end
    //push into logs stack
    this._pushLog(LOG_LEVELS.ERROR, this._formattedLog(LOG_LEVELS.ERROR, msg, this._callerName(3)));
  }


  //Helpers
  _isOffline = function () { return process.env.IS_OFFLINE; }
  _toDoubleDigit = function (str) { return String("0" + str).slice(-2); }
  _timestamp() {
    let d = new Date();
    return [this._toDoubleDigit(d.getMonth() + 1), this._toDoubleDigit(d.getDate()), d.getFullYear()].join('/') + ' ' +
      [this._toDoubleDigit(d.getHours()), this._toDoubleDigit(d.getMinutes()), this._toDoubleDigit(d.getSeconds())].join(':');
  }
  _formattedLog(level, msg, caller) {
    if (this._isOffline()) {
      return `  [${this._timestamp()} - ${LOG_STRINGS[level]}] [${caller}] ${msg.join(" ")}`;
    } else {
      return ` [${LOG_STRINGS[level]}] ${msg.join(" ")}`;
    }
  }
  _callerName(index) {
    let safeIndex = Math.min(index, stackTrace.get().length);
    if (stackTrace.get()[safeIndex]) {
      let callerName = (stackTrace.get()[safeIndex] ? stackTrace.get()[safeIndex].getTypeName() : null);
      if (!callerName) {
        callerName = stackTrace.get()[safeIndex].getFileName().split("/");
        callerName = callerName.slice(callerName.indexOf("src")).join("/");
      } return callerName + ":" + stackTrace.get()[safeIndex].getLineNumber();
    } return '';
  }
  _processLog(level, args) {
    if (level < this._LOG_LEVEL) return;
    //get args
    let msg = [];
    for (let arg of args) msg.push(((typeof arg === 'object' && !(arg instanceof Error)) ? stringify(arg, null, 2) : arg));
    //push into logs stack
    // todo: improve error stack - from idx is a bad choice
    this._pushLog(level, this._formattedLog(level, msg, this._callerName(3)));
  }
  _pushLog(level, fMsg) {
    this.serverless.serverless.cli.log(fMsg, 'hybridless');
  }
}
