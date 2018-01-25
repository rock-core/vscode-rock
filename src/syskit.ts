'use strict';

import * as autoproj from './autoproj';
import * as context from './context';
import * as wrappers from './wrappers';
import * as rest from 'node-rest-client';
import { CancellationToken } from 'vscode'

export class DeployedTask
{
    task_name : string;
    task_model_name : string;
}

export class AvailableDeployment
{
    name: string;
    project_name: string;
    tasks: DeployedTask[] = [];
    default_deployment_for: string | undefined;
    default_logger: string | undefined;
}

class DeploymentsAvailableResponse
{
    deployments: AvailableDeployment[];
};

export class RegisteredDeploymentInfo
{
    id : number;
    created : boolean;
    deployment_name: string;
    tasks : DeployedTask[];
    on : string;
    mappings : Map<string, string>;
    type : string;
}

export class CommandLine
{
    env: object;
    command : string;
    args: string[];
    working_directory: string;
};


export class Connection
{
    private _workspace : autoproj.Workspace;
    private _client : rest.Client;

    private _host : string;
    private _port : number;

    constructor(workspace : autoproj.Workspace,
        host : string = 'localhost',
        port : number = 20202)
    {
        this._workspace = workspace;
        this._client    = new rest.Client();
        this._host      = host;
        this._port      = port;
    }

    public start(bundlePath : string, vscode : wrappers.VSCode) {
        return vscode.runTask(`rock: syskit run - ${bundlePath}`);
    }

    private call<T>(method : string, path : string) : Promise<T>
    {
        return new Promise((resolve, reject) => {
            this._client[method](`http://${this._host}:${this._port}/api/syskit/${path}`, function (data, response) {
                resolve(data);
            }).on('error', function(err) {
                reject(err);
            })
        })
    }

    /** Starts a Syskit instance and connects to it
     */
    public async connect(token : CancellationToken)
    {
        while(!token.isCancellationRequested) {
            if (await this.attemptConnection()) {
                return;
            }
        }
        return Promise.reject(new Error("Cancelled connection to Syskit"));
    }

    public attemptConnection()
    {
        return new Promise((resolve, reject) => {
            this._client.get(`http://${this._host}:${this._port}/api/ping?value=42`, function (data, response) {
                resolve(true);
            }).on('error', function(err) {
                resolve(false);
            })
        })
    }

    public availableDeployments() : Promise<AvailableDeployment[]>
    {
        return this.call<DeploymentsAvailableResponse>('get', "deployments/available").
            then((response) => response.deployments);
    }

    public registerDeployment(modelName: string, taskName: string) : Promise<number>
    {
        return this.call<number>('post', `deployments?name=${modelName}&as=${taskName}`)
    }

    public commandLine(deployment : number) : Promise<CommandLine>
    {
        return this.call<CommandLine>('get', `deployments/${deployment}/command_line`)
    }

    public clear()
    {
        return this.call<CommandLine>('delete', `deployments`)
    }
};
