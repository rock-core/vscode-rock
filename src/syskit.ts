'use strict';

import * as autoproj from './autoproj';
import * as context from './context';
import * as wrappers from './wrappers';
import { CancellationToken } from 'vscode'
import * as request from 'request-promise-native';

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

type REST_METHODS = "GET" | "POST" | "PATCH" | "DELETE";

export interface Client
{
    call(method: REST_METHODS, uri: string) : Promise<any>;
};

export class RequestPromiseClient implements Client
{
    call(method: REST_METHODS, uri: string) : Promise<any> {
        let options = {
            method: method,
            uri: uri,
            resolveWithFullResponse: true,
            simple: false
        }
        return request(options);
    }
}


export class Connection
{
    private _workspace : autoproj.Workspace;
    private _client : Client;

    private _uriBase : string;

    constructor(workspace : autoproj.Workspace,
        uriBase : string = 'http://localhost:20202',
        client : Client = new RequestPromiseClient())
    {
        this._workspace = workspace;
        this._client    = client;
        this._uriBase   = uriBase;
    }

    private callBase(method : REST_METHODS, expectedStatus : number, path : string) : Promise<any>
    {
        let encodedPath = encodeURI(path).replace(/:/g, "%3A")
        let uri = `${this._uriBase}/api/${encodedPath}`;
        return this._client.call(method, uri).
            then((response) => {
                // This is NOT part of the tests
                //
                // JSON.parse("") and JSON.parse("a string") work in tests, fails
                // live, so add special cases here
                if (response.body.length === 0) {
                    return;
                }
                let data
                try { data = JSON.parse(response.body) }
                catch(e) { data = response.body }

                if (response.statusCode !== expectedStatus) {
                    let msg = data.error || data;
                    let errorType = response.headers['x-roby-error'];
                    let error = new Error(`${msg} (${method} ${uri})`);
                    if (errorType) {
                        error.name = errorType;
                    }
                    throw error;
                }
                else {
                    return data;
                }
            })
    }

    private callWithoutReturn(method : REST_METHODS, expectedStatus : number, path : string) : Promise<void>
    {
        return this.callBase(method, expectedStatus, path).then(() => {})
    }

    private call<T>(method : REST_METHODS, expectedStatus : number, path : string) : Promise<T>
    {
        return this.callBase(method, expectedStatus, path).then((data) => data as T);
    }

    /** Starts a Syskit instance and connects to it
     */
    public connect(token : CancellationToken)
    {
        let attempt = () => this.attemptConnection();
        let attempting = false;
        let pollId : NodeJS.Timer | undefined;
        let cancelTimer = () => {
            if (pollId) {
                clearTimeout(pollId);
            }
        }
        let p = new Promise((resolve, reject) => {
            (function poll() {
                if (!attempting) {
                    attempt().then((success) => {
                        attempting = false;
                        if (success) {
                            resolve()
                        }
                    }).catch(() => {})
                    attempting = true;
                }

                if (token.isCancellationRequested) {
                    reject(new Error("Syskit connection interrupted"));
                }
                else {
                    pollId = setTimeout(poll, 100);
                }
            })()
        })
        p.then(cancelTimer, cancelTimer);
        return p;
    }

    public attemptConnection()
    {
        return this.callWithoutReturn('GET', 200, 'ping?value=42').
            then(() => true).
            catch(() => false);
    }

    public availableDeployments() : Promise<AvailableDeployment[]>
    {
        return this.call<{ deployments: AvailableDeployment[] }>('GET', 200, "syskit/deployments/available").
            then((response) => response.deployments);
    }

    public registerDeployment(modelName: string, taskName?: string) : Promise<number>
    {
        let path = `syskit/deployments?name=${modelName}`;
        if (taskName) {
            path = `${path}&as=${taskName}`
        }
        return this.call<{ registered_deployment: number }>('POST', 201, path).
            then((response) => response.registered_deployment);
    }

    public commandLine(deployment : number) : Promise<CommandLine>
    {
        return this.call<CommandLine>('GET', 200, `syskit/deployments/${deployment}/command_line`)
    }

    public clear()
    {
        return this.callWithoutReturn('DELETE', 204, 'syskit/deployments')
    }

    public quit()
    {
        return this.callWithoutReturn('POST', 201, 'quit')
    }
};
