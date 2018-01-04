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

    name: string;
    readonly root: string;
    private _info: Promise<WorkspaceInfo>;

    constructor(root: string, loadInfo: boolean = true)
    {
        this.root = root;
        this.name = path.basename(root);
        this._info = this.createInfoPromise();
    }

    autoprojExePath() {
        return autoprojExePath(this.root);
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
        let manifest = yaml.safeLoad(data.toString());
        if (manifest === undefined) {
            manifest = [];
        }
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
    });
}

/** Dynamic management of a set of workspaces
 * 
 */
export class Workspaces
{
    devFolder : string | null;
    workspaces : Map<string, Workspace>
    folderToWorkspace : Map<string, Workspace>;

    constructor(devFolder = null) {
        this.devFolder = devFolder;
        this.workspaces = new Map();
        this.folderToWorkspace = new Map();
    }

    /** Add workspaces that contain some directory paths
     * 
     * The paths do not necessarily need to be within an autoproj workspace, in
     * which case they are ignored.
     * 
     * Returns the list of newly added workspaces
     */
    addCandidate(path: string) {
        // Workspaces are often duplicates (multiple packages from the same ws).
        // Make sure we don't start the info resolution promise until we're sure
        // it is new
        let ws = Workspace.fromDir(path, false);
        if (!ws) {
            return { added: false, workspace: null };
        }
        else if (this.workspaces.has(ws.root)) {
            return { added: false, workspace: this.workspaces.get(ws.root) };
        }
        else {
            this.add(ws);
            ws.info();
            return { added: true, workspace: ws };
        }
    }

    /** Add a folder
     * 
     * This adds the folder's workspace to the set, if the folder is part of an
     * Autoproj workspace, and returns it. Returns null if the folder is NOT
     * part of an autoproj workspace.
     */
    addFolder(path: string) {
        let { added, workspace } = this.addCandidate(path);
        if (workspace) {
            this.folderToWorkspace.set(path, workspace);
        }
        return workspace;
    }

    /** De-registers a folder
     * 
     * Removes a folder, and removes the corresponding workspace
     * if it was the last folder of this workspace - in which case
     * the workspace object is returned.
     */
    deleteFolder(path: string) {
        let ws = this.folderToWorkspace.get(path);
        this.folderToWorkspace.delete(path);
        if (ws) {
            if (this.useCount(ws) == 0) {
                this.delete(ws);
                return ws;
            }
        }
        return null;
    }

    /** 
     * Returns the number of registered folders that use this workspace
     */
    useCount(workspace : Workspace) {
        let result = 0;
        this.folderToWorkspace.forEach((ws) => {
            if (ws == workspace) {
                result += 1;
            }
        })
        return result;
    }

    /** Add workspaces to the workspace set
     */
    add(workspace : Workspace) {
        if (this.devFolder) {
            workspace.name = path.relative(this.devFolder, workspace.root);
        }
        this.workspaces.set(workspace.root, workspace);
    }

    /** Remove workspaces */
    delete(workspace: Workspace) {
        this.workspaces.delete(workspace.root);
    }

    /** Enumerate the workspaces
     * 
     * Yields (ws)
     */
    forEachWorkspace(callback) {
        this.workspaces.forEach(callback);
    }

    /** Enumerate the folders and workspaces
     * 
     * Yields (ws, folder)
     */
    forEachFolder(callback) {
        this.folderToWorkspace.forEach(callback);
    }

    /** Check whether a given folder is part of a workspace configuration
     *
     * Returns true if the folder is configuration, false otherwise
     */
    isConfig(folder: string): boolean
    {
        let isConfig = false;
        let arg = folder;
        this.forEachWorkspace((ws) => {
            let lastPath = ''
            let folder = arg;
            while (folder !== lastPath) {
                if ((folder == path.join(ws.root, "autoproj")) ||
                    (folder == path.join(ws.root, ".autoproj")))
                {
                    isConfig = true;
                    break;
                }
                lastPath = folder
                folder = path.dirname(folder);
            }
        })
        return isConfig;
    }
}
