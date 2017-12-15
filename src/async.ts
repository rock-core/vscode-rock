'use strict';

import * as proc from 'child_process';
import * as fs from 'fs';
import * as temp from 'fs-temp';
import * as path from 'path';
import * as autoproj from './autoproj';
import { SpawnOptions } from 'child_process';


export async function extractEnv(root: string): Promise<{ key: string, value: string }> {
    let tempRoot = temp.mkdirSync();
    let filePath = path.join(tempRoot, 'extract_env.rb');
    let rubyScript = "require 'json'; puts ENV.to_hash.to_json";
    let wsRoot = autoproj.findWorkspaceRoot(root);
    let options: SpawnOptions = {
        cwd: wsRoot
    }
    fs.writeFileSync(filePath, rubyScript);

    let promise = new Promise<{ key: string, value: string }>((resolve, reject) => {
        execute("bash", ["-c", "source env.sh; ruby " + filePath], options).then(
            result => {
                fs.unlinkSync(filePath);
                fs.rmdirSync(tempRoot);
                resolve(JSON.parse(result.stdout));
            },
            result => {
                fs.unlinkSync(filePath);
                fs.rmdirSync(tempRoot);
                console.log("Could not extract environment: " + result.message);
                reject(result.stderr);
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