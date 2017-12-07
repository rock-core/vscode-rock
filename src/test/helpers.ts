'use strict';

import * as Autoproj from '../autoproj'
import * as FS from 'fs';
import * as Temp from 'fs-temp';
import * as Path from 'path';
import * as YAML from 'js-yaml';

let root;
let createdFS = []

export function init(): string {
    root = Temp.mkdirSync();
    return root;
}

export function mkdir(...path): string {
    let joinedPath = Path.join(root, ...path);
    FS.mkdirSync(joinedPath);
    createdFS.push([joinedPath, 'dir']);
    return joinedPath;
}
export function mkfile(data: string, ...path): string {
    let joinedPath = Path.join(root, ...path);
    FS.writeFileSync(joinedPath, data)
    createdFS.push([joinedPath, 'file']);
    return joinedPath;
}
export function createInstallationManifest(data: any, ...workspacePath): string {
    let joinedPath = Path.join(root, ...workspacePath);
    joinedPath = Autoproj.installationManifestPath(joinedPath);
    FS.writeFileSync(joinedPath, YAML.safeDump(data));
    createdFS.push([joinedPath, 'file']);
    return joinedPath;
}
export function clear() {
    createdFS.reverse().forEach((entry) => {
        if (entry[1] === "file") {
            FS.unlinkSync(entry[0]);
        }
        else if (entry[1] === "dir") {
            FS.rmdirSync(entry[0]);
        }
    })
    createdFS = []
    FS.rmdirSync(root)
    root = null
}
