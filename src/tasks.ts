'use strict';
import * as vscode from 'vscode';
import * as autoproj from './autoproj';
import * as path from 'path';

export class Provider implements vscode.TaskProvider
{
    workspaces : autoproj.Workspaces;

    private _buildTasks: Map<string, vscode.Task>;
    private _forceBuildTasks: Map<string, vscode.Task>;
    private _updateTasks: Map<string, vscode.Task>;
    private _checkoutTasks: Map<string, vscode.Task>;
    private _osdepsTasks: Map<string, vscode.Task>;
    private _updateConfigTasks: Map<string, vscode.Task>;
    private _allTasks: vscode.Task[];

    private runAutoproj(ws, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: ws.root })
    }

    constructor(workspaces: autoproj.Workspaces)
    {
        this.workspaces = workspaces;
        this.reloadTasks();
    }

    private createTask(name, group, problemMatchers, ws, defs = {}, args = []) {
        let definition = { type: 'autoproj', workspace: ws.root, ...defs }
        let exec = this.runAutoproj(ws, ...args);
        let task = new vscode.Task(definition, name, 'autoproj', exec, []);
        task.group = group;
        task.problemMatchers = problemMatchers;
        return task;
    }

    private createOsdepsTask(name, ws, defs = {}, args = []) {
        return this.createTask(name, null, null, ws,
            { mode: 'osdeps', ...defs },
            ['osdeps', '--color', ...args]);
    }

    private createBuildTask(name, ws, defs = {}, args = []) {
        return this.createTask(name, vscode.TaskGroup.Build, ['$autoproj-build'],
            ws, { mode: 'build', ...defs },
            ['build', '--tool', ...args]);
    }

    private createUpdateTask(name, ws, defs = {}, args = []) {
        return this.createTask(name, null, null, ws,
            { mode: 'update', ...defs },
            ['update', '--progress=f', '-k', '--color', ...args]);
    }

    private createUpdateConfigTask(name, ws, defs = {}, args = []) {
        return this.createUpdateTask(name, ws,
            { mode: 'update-config', ...defs },
            [ '--config', ...args]);
    }

    private createCheckoutTask(name, ws, defs = {}, args = []) {
        return this.createUpdateTask(name, ws,
            { mode: 'checkout', ...defs },
            ['--checkout-only', ...args]);
    }

    private createPackageBuildTask(name, ws, folder, defs = {}, args = []) {
        return this.createBuildTask(name, ws,
            { folder: folder, ...defs },
            [...args, folder])
    }

    private createPackageForceBuildTask(name, ws, folder, defs = {}, args = []) {
        return this.createPackageBuildTask(name, ws, folder,
            { mode: 'force-build', ...defs },
            ['--force', '--deps=f', '--no-confirm', ...args]);
    }

    private createPackageUpdateTask(name, ws, folder, defs = {}, args = []) {
        return this.createUpdateTask(name, ws,
            { folder: folder, ...defs },
            [...args, folder]);
    }

    private createPackageCheckoutTask(name, ws, folder, defs = {}, args = []) {
        return this.createPackageUpdateTask(name, ws, folder,
            { mode: 'checkout', ...defs },
            ['--checkout-only', ...args]);
    }

    public buildTask(path: string): vscode.Task
    {
        return this._buildTasks.get(path);
    }

    public forceBuildTask(path: string): vscode.Task
    {
        return this._forceBuildTasks.get(path);
    }

    public updateTask(path: string): vscode.Task
    {
        return this._updateTasks.get(path);
    }

    public checkoutTask(path: string): vscode.Task
    {
        return this._checkoutTasks.get(path);
    }

    public osdepsTask(path: string): vscode.Task
    {
        return this._osdepsTasks.get(path);
    }

    public updateConfigTask(path: string): vscode.Task
    {
        return this._updateConfigTasks.get(path);
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

        this._buildTasks = new Map<string, vscode.Task>();
        this._forceBuildTasks = new Map<string, vscode.Task>();
        this._updateTasks = new Map<string, vscode.Task>();
        this._checkoutTasks = new Map<string, vscode.Task>();
        this._osdepsTasks = new Map<string, vscode.Task>();
        this._updateConfigTasks = new Map<string, vscode.Task>();

        this.workspaces.forEachWorkspace((ws) => {
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
            let relative = path.relative(ws.root, folder);
            this.addTask(folder, this.createPackageBuildTask(`${ws.name}: Build ${relative}`, ws, folder),
                this._buildTasks);
            this.addTask(folder, this.createPackageCheckoutTask(`${ws.name}: Checkout ${relative}`, ws, folder),
                this._checkoutTasks);
            this.addTask(folder, this.createPackageForceBuildTask(`${ws.name}: Force Build ${relative}`, ws, folder),
                this._forceBuildTasks);
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
