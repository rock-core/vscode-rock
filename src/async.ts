'use strict';

import * as proc from 'child_process';
import * as fs from 'fs';
import * as temp from 'fs-temp';
import * as path from 'path';
import * as autoproj from './autoproj';
import { SpawnOptions } from 'child_process';

const ENV_DUMP_SCRIPT = "require 'json'; puts ENV.to_hash.to_json";
const OROGEN_DESCRIBE_SCRIPT = `
require 'orogen'
require 'json'

class OrogenProject
    attr_reader :project, :loader
    def initialize(name)
        @loader = OroGen::Loaders::RTT.new
        @project = @loader.project_model_from_name(name)
    end

    def tasks
        project.self_tasks.keys
    end

    def deployment_name(model_name)
        OroGen::Spec::Project.default_deployment_name(model_name)
    end

    def deployment_binfile(model_name)
        loader.find_deployment_binfile(deployment_name(model_name))
    end

    def describe
        description = {}
        description[:tasks] = []
        description[:error] = nil
        tasks.each do |name|
            description[:tasks] << { model_name: name, deployment_name: deployment_name(name),
                                     file: deployment_binfile(name) }
        end
        description
    end
end

begin
    OroGen.log_level = :fatal
    project = OrogenProject.new ARGV[0]
    puts project.describe.to_json
rescue Exception => e
    description = {}
    description[:tasks] = nil
    description[:error] = e.message.lines.first
    puts description.to_json
end
`

export interface IOrogenTask {
    model_name: string,
    deployment_name: string,
    file: string
}

export class EnvironmentBridge
{
    constructor()
    {
    }

    async describeOrogenProject(root: string,
        project: string): Promise<IOrogenTask[]>
    {
        let description = jsonFromRubyScript(root, OROGEN_DESCRIBE_SCRIPT, project);
        let promise = new Promise<IOrogenTask[]>((resolve, reject) => {
            description.then(
                result => {
                    if (result.error)
                    {
                        reject(new Error("Could not load orogen project: " +
                            result["error"]));
                    }
                    else if (result.tasks.length == 0)
                    {
                        reject(new Error("No targets available for this project"));
                    }
                    else
                    {
                        resolve(result.tasks);
                    }
                },
                err => {
                    reject(new Error("Could not load orogen project: " + err.message));
                }
            )
        });
        return promise;
    }

    async env(root: string): Promise<{ [key: string]: string }>
    {
        let env = jsonFromRubyScript(root, ENV_DUMP_SCRIPT);
        let promise = new Promise<{ [key: string]: string }>((resolve, reject) => {
            env.then(
                result => {
                    resolve(result);
                },
                err => {
                    reject(new Error("Could not load environment: " + err.message));
                }
            )
        });
        return promise;
    }
}

export async function jsonFromRubyScript(root: string, script: string,
    ...args): Promise<any>
{
    let argList = args.join(' ');
    let tempRoot = temp.mkdirSync();
    let filePath = path.join(tempRoot, 'temp_script.rb');
    let wsRoot = autoproj.findWorkspaceRoot(root);
    if (!wsRoot) {
        throw new Error(root + " is not within an autoproj workspace");
    }
    let options: SpawnOptions = {
        cwd: wsRoot
    }

    if (!wsRoot)
        return Promise.reject(new Error("Could not find autoproj root"));

    if (argList.length > 0) argList = " " + argList;
    fs.writeFileSync(filePath, script);

    let promise = new Promise<any>((resolve, reject) => {
        execute("bash", ["-c", "source env.sh && ruby " + filePath + argList], options).then(
            result => {
                fs.unlinkSync(filePath);
                fs.rmdirSync(tempRoot);
                console.log(result.stdout);
                console.log(result.stderr);

                if (result.retc != 0)
                {
                    reject(new Error(result.stderr));
                }
                else
                {
                    resolve(JSON.parse(result.stdout));
                }
            },
            err => {
                fs.unlinkSync(filePath);
                fs.rmdirSync(tempRoot);
                console.log(err.message);
                reject(err);
            }
        );
    });
    return promise;
}

export interface IExecutionResult {
    retc: Number;
    stdout: string;
    stderr: string;
}

export function execute(command: string, args: string[], options?: proc.SpawnOptions): Promise<IExecutionResult> {
    return new Promise<IExecutionResult>((resolve, reject) => {
        const child = proc.spawn(command, args, options);
        child.on('error', (err) => {
            reject(err);
        });
        let stdout_acc = '';
        let stderr_acc = '';
        child.stdout.on('data', (data: Uint8Array) => {
            stdout_acc += data.toString();
        });
        child.stderr.on('data', (data: Uint8Array) => {
            stderr_acc += data.toString();
        });
        child.on('exit', (retc) => {
            resolve({retc: retc, stdout: stdout_acc, stderr: stderr_acc});
        });
    });
}
