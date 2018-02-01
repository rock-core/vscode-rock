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
        port : number = 20202,
        client : rest.Client = new rest.Client())
    {
        this._workspace = workspace;
        this._client    = client;
        this._host      = host;
        this._port      = port;
    }

    private callBase(method : string, expectedStatus : number, path : string) : Promise<any>
    {
        return new Promise((resolve, reject) => {
            let url = `http://${this._host}:${this._port}/api/${path}`;
            this._client[method](url, function (data, response) {
                if (response.statusCode !== expectedStatus) {
                    let msg = data.error || data;
                    reject(new Error(`${method} ${url} error: ${msg}`));
                }
                else {
                    resolve(data);
                }
            }).on('error', function(err) {
                reject(err);
            })
        })
    }

    private callWithoutReturn(method : string, expectedStatus : number, path : string) : Promise<void>
    {
        return this.callBase(method, expectedStatus, path).then(() => {})
    }

    private call<T>(method : string, expectedStatus : number, path : string) : Promise<T>
    {
        return this.callBase(method, expectedStatus, path).then((data) => data as T);
    }

    /** Starts a Syskit instance and connects to it
     */
    public async connect(token : CancellationToken)
    {
        let attempt = () => this.attemptConnection();
        return new Promise((resolve, reject) => {
            (async function poll() {
                if (await attempt()) {
                    resolve();
                }
                else if (token.isCancellationRequested) {
                    reject(new Error("Syskit connection interrupted"));
                }
                else {
                    setTimeout(poll, 100);
                }
            })()
        })
    }

    public attemptConnection()
    {
        return this.callWithoutReturn('get', 200, 'ping?value=42').
            then(() => true).
            catch(() => false);
    }

    public availableDeployments() : Promise<AvailableDeployment[]>
    {
        return this.call<{ deployments: AvailableDeployment[] }>('get', 200, "syskit/deployments/available").
            then((response) => response.deployments);
    }

    public registerDeployment(modelName: string, taskName: string) : Promise<number>
    {
        return this.call<{ registered_deployment: number }>('post', 201, `syskit/deployments?name=${modelName}&as=${taskName}`).
            then((response) => response.registered_deployment);
    }

    public commandLine(deployment : number) : Promise<CommandLine>
    {
        return this.call<CommandLine>('get', 200, `syskit/deployments/${deployment}/command_line`)
    }

    public clear()
    {
        return this.callWithoutReturn('delete', 204, 'syskit/deployments')
    }

    public quit()
    {
        return this.callWithoutReturn('post', 201, 'quit')
    }
};
