'use strict';

import * as yaml from 'js-yaml';
import * as path from 'path';
import * as global from 'glob';
import * as fs from 'fs';

export function findWorkspaceRoot(rootPath: string): string
{
    let lastPath = ''
    while (rootPath !== lastPath) {
        if (fs.existsSync(path.join(rootPath, '.autoproj', 'installation-manifest'))) {
            return rootPath
        }
        lastPath = rootPath
        rootPath = path.dirname(rootPath);
    }
    return null
}

export function autoprojExePath(workspacePath: string): string
{
    return path.join(workspacePath, '.autoproj', 'bin', 'autoproj')
}
export function installationManifestPath(workspacePath: string): string
{
    return path.join(workspacePath, '.autoproj', 'installation-manifest')
}

export interface VCS
{
    type: string;
    url: string;
    repository_id: string;
}

export interface Package
{
    name: string;
    type: string;
    vcs: VCS;
    srcdir: string;
    builddir: string;
    logdir: string;
    prefix: string;
    dependencies: Array<string>;
}

export interface PackageSet
{
    name: string;
    vcs: VCS;
    raw_local_dir: string;
    user_local_dir: string;
}

class WorkspaceInfo
{
    path: string;
    packages: Map<string, Package>;
    packageSets: Map<string, PackageSet>;
}

export class Workspace
{
    static fromDir(path: string, loadInfo: boolean = true)
    {
        let root = findWorkspaceRoot(path);
        if (!root)
        {
            return null;
        }

        return new Workspace(root, loadInfo);
    }

    readonly root: string;
    private _info: Promise<WorkspaceInfo>;

    constructor(root: string, loadInfo: boolean = true)
    {
        this.root = root;
        this._info = this.createInfoPromise();
    }

    private createInfoPromise()
    {
        return loadWorkspaceInfo(this.root);
    }

    reload()
    {
        this._info = this.createInfoPromise()
        return this._info;
    }

    info(): Promise<WorkspaceInfo>
    {
        if (this._info)
        {
            return this._info;
        }
        else
        {
            return this.reload();
        }
    }
}

export function loadWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo>
{
    return new Promise<Buffer>((resolve, reject) => 
    {
        fs.readFile(installationManifestPath(workspacePath), (err, data) =>
        {
            if (err) {
                reject(err);
            }
            else
            {
                resolve(data);
            }
        })
    }).then((data) =>
    {
        const manifest = yaml.safeLoad(data.toString());
        let packageSets = new Map()
        let packages = new Map()
        manifest.forEach((entry) => {
            if (entry.name) {
                packages.set(entry.name, entry)
            }
            else {
                entry.name = entry.package_set;
                delete entry.package_set;
                packageSets.set(entry.name, entry)
            }
        })
        return { path: workspacePath, packageSets: packageSets, packages: packages };
    })
}
