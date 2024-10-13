import Hybridless = require('..');
//
import { DockerFiles } from './Globals';
//
import Dockerode = require('dockerode');
import BPromise = require('bluebird');
import tarFS = require('tar-fs');
//
export default class Docker {
  private readonly _d: Dockerode;
  private readonly plugin: Hybridless;
  //
  constructor(plugin: Hybridless) {
    this._d = this._newDocker();
    this.plugin = plugin;
  }
  private _newDocker(): Dockerode {
    return new Dockerode({
      socketPath: '/var/run/docker.sock'
    });
  }
  //
  public async buildImage(files: DockerFiles, imageName: string, args?: { [key: string]: string }): BPromise {
    const chunks = [];
    return new BPromise(async (resolve, reject) => {
      this.plugin.logger.info(`Building docker image.. (${imageName})`);
      const tarData = await this._packDocker(files);
      await this._d.buildImage(tarData, { 
        t: imageName,
        ...(args ? { buildargs: args } : {})
      }, (err, response) => {
        if (err) reject(err);
        else if (response) {
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', (err) => reject(err));
          response.on('end', () => {
            const resp = Buffer.concat(chunks).toString('utf8');
            // Extract IDs
            const regex = /"ID":"sha256:([a-fA-F0-9]{64})"/g;
            const matches = [...resp.matchAll(regex)];
            const IDs = matches.map(match => match[1]);
            if (resp.includes('Successfully built') && IDs) {
              this.plugin.logger.info('Docker image built!');
              resolve(IDs);
            } else {
              this.plugin.logger.info('Docker image build error!');
              reject(resp);
            }
          });
        } else reject('Invalid response..');
      });
    });
  }
  public async deleteImage(imageName: string): BPromise {
    return new BPromise(async (resolve, reject) => {
      this.plugin.logger.info(`Deleting docker image.. (${imageName})`);
      const image = await this._d.getImage(imageName)
      if (image)  {
        await image.remove({ force: true })
        this.plugin.logger.info('Docker image removed!')
        resolve()
      } else {
        this.plugin.logger.info('Docker image not found error!')
        reject('Docker image not found error!')
      }
    });
  }

  private async _packDocker(files: DockerFiles): BPromise {
    return new BPromise((resolve, reject) => {
      resolve(tarFS.pack('/', {
        entries: files.map((file) => file.dir + '/' + file.name),
        map: (file: any) => {
          //For each of available files, check for dir and remove
          for (let specFile of files) {
            const source = specFile.dir + '/' + specFile.name;
            if (file.name.includes(source)) {
              file.name = file.name.replace(source, specFile.dest);
              break;
            }
          }
          //
          return file;
        }
      }));
    });
  }
}