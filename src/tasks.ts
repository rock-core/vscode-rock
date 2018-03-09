'use strict';
import * as vscode from 'vscode';
import * as autoproj from './autoproj';
import * as path from 'path';
import * as context from './context';

function runAutoproj(ws, ...args) {
    return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: ws.root })
}

export class AutoprojProvider implements vscode.TaskProvider
{
    workspaces : autoproj.Workspaces;

    private _watchTasks: Map<string, vscode.Task>;
    private _buildTasks: Map<string, vscode.Task>;
    private _nodepsBuildTasks: Map<string, vscode.Task>;
    private _forceBuildTasks: Map<string, vscode.Task>;
    private _updateTasks: Map<string, vscode.Task>;
    private _checkoutTasks: Map<string, vscode.Task>;
    private _osdepsTasks: Map<string, vscode.Task>;
    private _updateConfigTasks: Map<string, vscode.Task>;
    private _allTasks: vscode.Task[];

    constructor(workspaces: autoproj.Workspaces)
    {
        this.workspaces = workspaces;
        this.reloadTasks();
    }

    private createTask(name, ws, defs = {}, args : string[] = []) {
        let definition = { type: 'autoproj', workspace: ws.root, ...defs }
        let exec = runAutoproj(ws, ...args);
        return new vscode.Task(definition, name, 'autoproj', exec, []);
    }

    private createOsdepsTask(name, ws, defs = {}, args : string[] = []) {
        return this.createTask(name, ws,
            { mode: 'osdeps', ...defs },
            ['osdeps', '--color', ...args]);
    }

    private createWatchTask(name, ws, defs = {}, args : string[] = []) {
        return this.createTask(name, ws,
            { mode: 'watch', ...defs },
            ['watch', '--show-events', ...args]);
    }

    private createBuildTask(name, ws, defs = {}, args : string[] = []) {
        let task = this.createTask(name, ws,
            { mode: 'build', ...defs },
            ['build', '--tool', ...args]);
        task.group = vscode.TaskGroup.Build;
        task.problemMatchers = [
            '$autoproj-cmake-configure-error',
            '$autoproj-cmake-configure-warning',
            '$autoproj-gcc-compile-error',
            '$autoproj-gcc-compile-warning',
            '$autoproj-orogen-error'
        ];
        return task;
    }

    private createUpdateTask(name, ws, defs = {}, args : string[] = []) {
        let task = this.createTask(name, ws,
            { mode: 'update', ...defs },
            ['update', '--progress=f', '-k', '--color', ...args]);
        task.problemMatchers = ['$autoproj'];
        return task;
    }

    private createUpdateConfigTask(name, ws, defs = {}, args : string[] = []) {
        let task= this.createUpdateTask(name, ws,
            { mode: 'update-config', ...defs },
            [ '--config', ...args]);
        task.problemMatchers = ['$autoproj'];
        return task;
    }

    private createCheckoutTask(name, ws, defs = {}, args : string[] = []) {
        let task = this.createUpdateTask(name, ws,
            { mode: 'checkout', ...defs },
            ['--checkout-only', ...args]);
        task.problemMatchers = ['$autoproj'];
        return task;
    }

    private createPackageBuildTask(name, ws, folder, defs = {}, args : string[] = []) {
        return this.createBuildTask(name, ws,
            { folder: folder, ...defs },
            [...args, folder])
    }

    private createPackageNodepsBuildTask(name, ws, folder, defs = {}, args : string[] = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: 'build-no-deps', ...defs },
            ['--deps=f', ...args]);
    }

    private createPackageForceBuildTask(name, ws, folder, defs = {}, args : string[] = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: 'force-build', ...defs },
            ['--force', '--deps=f', '--no-confirm', ...args]);
    }

    private createPackageUpdateTask(name, ws, folder, defs = {}, args : string[] = []) {
        let task = this.createUpdateTask(name, ws,
            { folder: folder, ...defs },
            [...args, folder]);
        task.problemMatchers = ['$autoproj'];
        return task;
    }

    private createPackageCheckoutTask(name, ws, folder, defs = {}, args : string[] = []) {
        let task = this.createPackageUpdateTask(name, ws, folder,
            { mode: 'checkout', ...defs },
            ['--checkout-only', ...args]);
        task.problemMatchers = ['$autoproj'];
        return task;
    }

    private getCache(cache, key)
    {
        let value = cache.get(key);
        if (value) {
            return value;
        }
        throw new Error("no entry for " + path);
    }
    public buildTask(path: string): vscode.Task
    {
        return this.getCache(this._buildTasks, path);
    }

    public watchTask(path: string): vscode.Task
    {
        return this.getCache(this._watchTasks, path);
    }

    public forceBuildTask(path: string): vscode.Task
    {
        return this.getCache(this._forceBuildTasks, path);
    }

    public nodepsBuildTask(path: string): vscode.Task
    {
        return this.getCache(this._nodepsBuildTasks, path);
    }

    public updateTask(path: string): vscode.Task
    {
        return this.getCache(this._updateTasks, path);
    }

    public checkoutTask(path: string): vscode.Task
    {
        return this.getCache(this._checkoutTasks, path);
    }

    public osdepsTask(path: string): vscode.Task
    {
        return this.getCache(this._osdepsTasks, path);
    }

    public updateConfigTask(path: string): vscode.Task
    {
        return this.getCache(this._updateConfigTasks, path);
    }

    private addTask(root: string, task: vscode.Task,
        cache: Map<string, vscode.Task>)
    {
        this._allTasks.push(task);
        cache.set(root, task);
    }

    reloadTasks()
    {
        this._allTasks = [];

        this._watchTasks = new Map<string, vscode.Task>();
        this._buildTasks = new Map<string, vscode.Task>();
        this._nodepsBuildTasks = new Map<string, vscode.Task>();
        this._forceBuildTasks = new Map<string, vscode.Task>();
        this._updateTasks = new Map<string, vscode.Task>();
        this._checkoutTasks = new Map<string, vscode.Task>();
        this._osdepsTasks = new Map<string, vscode.Task>();
        this._updateConfigTasks = new Map<string, vscode.Task>();

        this.workspaces.forEachWorkspace((ws) => {
            this.addTask(ws.root, this.createWatchTask(`${ws.name}: Watch`, ws),
                this._watchTasks);
            this.addTask(ws.root, this.createBuildTask(`${ws.name}: Build`, ws),
                this._buildTasks);
            this.addTask(ws.root, this.createCheckoutTask(`${ws.name}: Checkout`, ws),
                this._checkoutTasks);
            this.addTask(ws.root, this.createOsdepsTask(`${ws.name}: Install OS Dependencies`, ws),
                this._osdepsTasks);
            this.addTask(ws.root, this.createUpdateConfigTask(`${ws.name}: Update Configuration`, ws),
                this._updateConfigTasks);
            this.addTask(ws.root, this.createUpdateTask(`${ws.name}: Update`, ws),
                this._updateTasks);
        })
        this.workspaces.forEachFolder((ws, folder) => {
            if (folder == ws.root) { return; }
            if (this.workspaces.isConfig(folder)) { return; }
            let relative = path.relative(ws.root, folder);
            this.addTask(folder, this.createPackageBuildTask(`${ws.name}: Build ${relative}`, ws, folder),
                this._buildTasks);
            this.addTask(folder, this.createPackageCheckoutTask(`${ws.name}: Checkout ${relative}`, ws, folder),
                this._checkoutTasks);
            this.addTask(folder, this.createPackageForceBuildTask(`${ws.name}: Force Build ${relative} (nodeps)`, ws, folder),
                this._forceBuildTasks);
            this.addTask(folder, this.createPackageNodepsBuildTask(`${ws.name}: Build ${relative} (nodeps)`, ws, folder),
                this._nodepsBuildTasks);
            this.addTask(folder, this.createPackageUpdateTask(`${ws.name}: Update ${relative}`, ws, folder),
                this._updateTasks);
        })
    }

    provideTasks(token)
    {
        return this._allTasks;
    }

    resolveTask(task, token)
    {
        return null;
    }
}
