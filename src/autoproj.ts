'use strict';

import * as child_process from 'child_process';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as global from 'glob';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as syskit from './syskit';
import * as wrappers from './wrappers';
import { EventEmitter } from 'events';

export function findWorkspaceRoot(rootPath: string): string | null
{
    let lastPath = ''
    while (rootPath !== lastPath) {
        if (fs.existsSync(path.join(rootPath, '.autoproj', 'installation-manifest'))) {
            return rootPath
        }
        lastPath = rootPath
        rootPath = path.dirname(rootPath);
    }
    return null;
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

export class WorkspaceInfo
{
    path: string;
    packages: Map<string, Package>;
    packageSets: Map<string, PackageSet>;

    constructor(
            path: string,
            packages: Map<string, Package> = new Map<string, Package>(),
            packageSets: Map<string, PackageSet> = new Map<string, PackageSet>()) {
        this.path = path;
        this.packages = packages;
        this.packageSets = packageSets;
    }

    findPackage(path: string): Package | undefined {
        return this.packages.get(path);
    }

    findPackageSet(path: string): PackageSet | undefined {
        return this.packageSets.get(path);
    }

    find(path: string): Package | PackageSet | undefined {
        return this.findPackage(path) || this.findPackageSet(path);
    }
}

export interface Process extends EventEmitter
{
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (string) => void;
}

export interface OutputChannel
{
    appendLine(string) : void;
}

class ConsoleOutputChannel implements OutputChannel
{
    appendLine(value: string)
    {
        console.log(value);
    }
}

export class Workspace
{
    static fromDir(path: string, loadInfo: boolean = true, outputChannel: OutputChannel = new ConsoleOutputChannel())
    {
        let root = findWorkspaceRoot(path);
        if (!root)
        {
            return null;
        }

        return new Workspace(root, loadInfo, outputChannel);
    }

    // The workspace name
    name: string;
    // The workspace root directory
    readonly root: string;
    private _info: Promise<WorkspaceInfo>;
    private _infoUpdatedEvent : vscode.EventEmitter<WorkspaceInfo>;
    private _outputChannel : OutputChannel;

    private _syskitDefaultRun : { subprocess?: Process, started?: Promise<void>, running?: Promise<void>, interrupt?: any } = {};
    private _pendingWorkspaceInit : Promise<void> | undefined;
    private _verifiedSyskitContext : boolean;

    constructor(root: string, loadInfo: boolean = true, outputChannel: OutputChannel = new ConsoleOutputChannel())
    {
        this.root = root;
        this.name = path.basename(root);
        this._outputChannel = outputChannel;
        this._verifiedSyskitContext = false;
        this._infoUpdatedEvent = new vscode.EventEmitter<WorkspaceInfo>();
        this._pendingWorkspaceInit = undefined;
        if (loadInfo) {
            this._info = this.createInfoPromise();
        }
    }

    autoprojExePath() {
        return autoprojExePath(this.root);
    }

    autoprojExec(command: string, args: string[],
        options: child_process.SpawnOptions = {}) : Process
    {
        return child_process.spawn(
            this.autoprojExePath(), ['exec', command, ...args],
            { cwd: this.root, stdio: 'pipe', env: process.env, ...options }
        );
    }

    syskitExec(args: string[],
        options: child_process.SpawnOptions = {}) : Process
    {
        let env = options.env || process.env;
        delete env.ROCK_BUNDLE;
        return this.autoprojExec('syskit', args, { ...options, env: env });
    }

    private createInfoPromise()
    {
        return loadWorkspaceInfo(this.root);
    }

    loadingInfo() : boolean {
        return this._info !== undefined;
    }

    reload()
    {
        this._info = this.createInfoPromise()
        this._info.then((info) => { this._infoUpdatedEvent.fire(info) });
        return this._info;
    }

    dispose() {
        this._infoUpdatedEvent.dispose();
        this.syskitDefaultStop();
    }

    onInfoUpdated(callback: (info: WorkspaceInfo) => any) : vscode.Disposable {
        return this._infoUpdatedEvent.event(callback);
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

    envsh(): Promise<WorkspaceInfo>
    {
        const subprocess = child_process.spawn(
            this.autoprojExePath(),
            ['envsh', '--color'],
            { cwd: this.root, stdio: 'pipe' }
        );
        this.redirectProcessToChannel('autoproj envsh', 'envsh', subprocess);
        return new Promise<WorkspaceInfo>((resolve, reject) => {
            subprocess.on('exit', (code, status) => {
                if (code === 0) {
                    resolve(this.reload());
                }
                else {
                    resolve(this.info());
                }
            })
        })
    }

    which(cmd: string)
    {
        let options: child_process.SpawnOptions = { env: {} };
        Object.assign(options.env, process.env);
        Object.assign(options.env, { AUTOPROJ_CURRENT_ROOT: this.root });
        let subprocess = child_process.spawn(this.autoprojExePath(), ['which', cmd], options);
        let path = '';
        this.redirectProcessToChannel(`autoproj which ${cmd}`, `which ${cmd}`, subprocess);
        subprocess.stdout.on('data', (buffer) => {
            path = path.concat(buffer.toString());
        })

        return new Promise<string>((resolve, reject) => {
            subprocess.on('exit', (code, signal) => {
                if (code !== 0) {
                    reject(new Error(`cannot find ${cmd} in the workspace`))
                }
                else {
                    resolve(path.trim());
                }
            })
        })
    }

    private runCommandToCompletion(subprocess, error?: string) : Promise<void> {
        return new Promise<void>((resolve, reject) => {
            subprocess.on('exit', (code, signal) => {
                if (code == 0) {
                    resolve();
                }
                else {
                    reject(new Error(error));
                }
            });
        });
    }

    public syskitDefaultBundle() : string {
        return path.join(this.root, '.vscode', 'rock-default-bundle');
    }

    private syskitDefaultSocketPath() : string {
        return path.join(this.root, '.vscode', `syskit-socket-${process.pid}`);
    }

    private syskitDefaultURIBase() : string {
        return `http://unix:${this.syskitDefaultSocketPath()}:`;
    }

    public syskitGenApp(path: string) : Promise<void> {
        let subprocess = this.syskitExec(["gen", "app", path]);
        this.redirectProcessToChannel(`syskit gen ${path}`, "gen", subprocess);
        return this.runCommandToCompletion(subprocess, `failed to run \`syskit gen app ${path}\``);
    }

    public syskitCheckApp(path: string) : Promise<void> {
        let subprocess = this.syskitExec(["check"], { cwd: this.defaultBundlePath() });
        this.redirectProcessToChannel(`syskit check ${path}`, "check", subprocess);
        return this.runCommandToCompletion(subprocess, `bundle in ${path} seem invalid, or syskit cannot be executed in this workspace`);
    }

    public defaultBundlePath() : string {
        return path.join(this.root, '.vscode', 'rock-default-bundle');
    }

    public hasValidSyskitContext() : Promise<boolean> {
        // We do the cheap existence check even if the syskit context has been
        // verified. This would allow the user to "reset" the bundle by deleting
        // the bundle folder without having to restart VSCode, with a small
        // performance cost
        let bundlePath = this.defaultBundlePath();
        if (!fs.existsSync(bundlePath)) {
            return Promise.resolve(false);
        }

        if (this._verifiedSyskitContext) {
            return Promise.resolve(true);
        }

        return this.syskitCheckApp(bundlePath).
            then(() => {
                this._verifiedSyskitContext = true;
                return true;
            }).
            catch(() => false);
    }

    public ensureSyskitContextAvailable(): Promise<void>
    {
        let pending = this._pendingWorkspaceInit;
        if (pending) {
            return pending;
        }

        let p = this.hasValidSyskitContext().then((result) => {
            if (result) {
                this._pendingWorkspaceInit = undefined;
            }
            else {
                let bundlePath = this.defaultBundlePath();
                return this.syskitGenApp(bundlePath).
                    then(
                        ()  => { this._pendingWorkspaceInit = undefined },
                        (e) => { this._pendingWorkspaceInit = undefined; throw e; }
                    );
            }
        })

        this._pendingWorkspaceInit = p;
        return p;
    }

    public readWatchPID(): Promise<number>
    {
        return new Promise((resolve, reject) => {
            fs.readFile(path.join(this.root, '.autoproj', 'watch'),
                (err, data) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        let pid = Number(data.toString());
                        if (isNaN(pid) || pid == 0) {
                            reject(new Error("invalid watch PID file"));
                        }
                        else {
                            resolve(pid);
                        }
                    }
                })
        })
    }

    // Private API, made public only for testing reasons
    private redirectProcessToChannel(name, shortname, subprocess : Process)
    {
        this._outputChannel.appendLine(`${shortname}: starting ${name}`)
        subprocess.stderr.on('data', (buffer) => {
            let lines = buffer.toString().split("\n");
            lines.forEach((l) => {
                this._outputChannel.appendLine(`${shortname}: ${l}`)
            })
        })
        subprocess.stdout.on('data', (buffer) => {
            let lines = buffer.toString().split("\n");
            lines.forEach((l) => {
                this._outputChannel.appendLine(`${shortname}: ${l}`)
            })
        })
        subprocess.on('exit', () => {
            this._outputChannel.appendLine(`${shortname}: ${name} quit`)
        })
    }

    syskitDefaultStart() : Promise<void>
    {
        if (this._syskitDefaultRun.running) {
            return this._syskitDefaultRun.running;
        }

        let available = this.ensureSyskitContextAvailable();
        let started = available.then(() => {
            let subprocess = this.syskitExec(['run', '--no-interface', '--no-logs', `--rest=${this.syskitDefaultSocketPath()}`],
                { cwd: this.syskitDefaultBundle() });
            this.redirectProcessToChannel(`syskit background process for ${this.root}`, 'syskit run', subprocess);
            return subprocess;
        });
        let running = started.then((subprocess) => {
            let cleanup = () => {
                if (this._syskitDefaultRun.interrupt) {
                    clearTimeout(this._syskitDefaultRun.interrupt);
                }
                this._syskitDefaultRun = {}
            }
            let p = new Promise<void>((resolve, reject) => {
                subprocess.on('exit', (code, status) => {
                    reject(new Error(`syskit background process for ${this.root} quit`));
                })
            });
            p.then(cleanup, cleanup);
            this._syskitDefaultRun.subprocess = subprocess;
            return p;
        })
        this._syskitDefaultRun.started = started.then((subprocess) => {});
        this._syskitDefaultRun.running = running;
        return running;
    }

    syskitDefaultStarted() : Promise<void> {
        if (this._syskitDefaultRun.started) {
            return this._syskitDefaultRun.started;
        }
        else {
            return Promise.reject(new Error(`Syskit background process for ${this.root} has not been started`));
        }
    }

    syskitDefaultStop(timeout = 2000) : Promise<void>
    {
        if (!this._syskitDefaultRun.started) {
            return Promise.resolve();
        }

        this._syskitDefaultRun.interrupt = setTimeout(() => {
            if (this._syskitDefaultRun.subprocess) {
                this._syskitDefaultRun.subprocess.kill("SIGINT");
            }
        }, timeout);

        let tokenSource = new vscode.CancellationTokenSource();
        let c = new syskit.Connection(this, this.syskitDefaultURIBase());
        c.connect(tokenSource.token).then(() => c.quit()).
            catch(() => {})

        let running = this._syskitDefaultRun.running as Promise<void>;
        return running.
            catch(() => {
                tokenSource.cancel();

            });
    }

    async syskitDefaultConnection() : Promise<syskit.Connection>
    {
        await this.ensureSyskitContextAvailable();
        let c = new syskit.Connection(this, this.syskitDefaultURIBase());
        let tokenSource = new vscode.CancellationTokenSource();

        let start = this.syskitDefaultStart();
        start.then(
            () => {},
            () => tokenSource.cancel());
        return c.connect(tokenSource.token).then(() => c);
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
        let manifest = yaml.safeLoad(data.toString()) as any[];
        if (manifest === undefined) {
            manifest = [];
        }
        let packageSets = new Map()
        let packages = new Map()
        manifest.forEach((entry) => {
            if (entry.name) {
                packages.set(entry.srcdir, entry)
            }
            else {
                entry.name = entry.package_set;
                delete entry.package_set;
                packageSets.set(entry.user_local_dir, entry)
            }
        })
        return new WorkspaceInfo(workspacePath, packages, packageSets);
    });
}

/** Dynamic management of a set of workspaces
 *
 */
export class Workspaces
{
    devFolder : string | null;
    workspaces = new Map<string, Workspace>();
    folderToWorkspace = new Map<string, Workspace>();
    private _outputChannel : { appendLine: (string) => void };
    private _workspaceInfoEvent = new vscode.EventEmitter<WorkspaceInfo>();
    private _folderInfoEvent = new vscode.EventEmitter<Package | PackageSet>();
    private _folderInfoDisposables = new Map<string, vscode.Disposable>();

    constructor(devFolder = null, outputChannel : OutputChannel = new ConsoleOutputChannel()) {
        this.devFolder = devFolder;
        this._outputChannel = outputChannel;
    }

    dispose() {
        this.workspaces.forEach((ws) => ws.dispose());
        this._workspaceInfoEvent.dispose();
        this._folderInfoEvent.dispose();
        this._folderInfoDisposables.forEach((d) => d.dispose());
    }

    onWorkspaceInfo(callback : (info: WorkspaceInfo) => any) : vscode.Disposable {
        return this._workspaceInfoEvent.event(callback);
    }

    onFolderInfo(callback : (info: Package | PackageSet) => any) : vscode.Disposable {
        return this._folderInfoEvent.event(callback);
    }

    /** Add workspaces that contain some directory paths
     *
     * The paths do not necessarily need to be within an autoproj workspace, in
     * which case they are ignored.
     *
     * Returns the list of newly added workspaces
     */
    addCandidate(path: string, loadInfo: boolean = true) {
        // Workspaces are often duplicates (multiple packages from the same ws).
        // Make sure we don't start the info resolution promise until we're sure
        // it is new
        let wsRoot = findWorkspaceRoot(path);
        if (!wsRoot) {
            return { added: false, workspace: null };
        }
        else if (this.workspaces.has(wsRoot)) {
            return { added: false, workspace: this.workspaces.get(wsRoot) };
        }
        else {
            let ws = new Workspace(wsRoot, loadInfo, this._outputChannel);
            this.add(ws);
            ws.onInfoUpdated((info) => {
                this._workspaceInfoEvent.fire(info);
            })
            return { added: true, workspace: ws };
        }
    }

    /** Associate a folder to a workspace
     */
    associateFolderToWorkspace(path: string, workspace: Workspace) {
        this.folderToWorkspace.set(path, workspace);
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
            this.associateFolderToWorkspace(path, workspace);
            let event = workspace.onInfoUpdated((info) => {
                let pkgInfo = info.find(path);
                if (pkgInfo) {
                    this._folderInfoEvent.fire(pkgInfo);
                }
            })
            this._folderInfoDisposables.set(path, event);
        }
        return { added, workspace };
    }

    /** De-registers a folder
     *
     * Removes a folder, and removes the corresponding workspace
     * if it was the last folder of this workspace - in which case
     * the workspace object is returned.
     */
    deleteFolder(path: string) {
        let ws = this.folderToWorkspace.get(path);
        let event = this._folderInfoDisposables.get(path);
        if (event) {
            event.dispose();
        }
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
        if (this.useCount(workspace) !== 0) {
            throw new Error("cannot remove a workspace that is in-use");
        }
        workspace.dispose();
        this.workspaces.delete(workspace.root);
    }

    /** Enumerate the workspaces
     *
     * Yields (ws)
     */
    forEachWorkspace(callback: (ws: Workspace) => void) {
        this.workspaces.forEach(callback);
    }

    /** Enumerate the folders and workspaces
     *
     * Yields (ws, folder)
     */
    forEachFolder(callback: (ws: Workspace, folder: string) => void) {
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

    /** Returns the workspace that matches a package folder
     */
    getWorkspaceFromFolder(folder : string) : Workspace | undefined
    {
        return this.folderToWorkspace.get(folder);
    }
}
