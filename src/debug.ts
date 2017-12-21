import * as context from './context'
import * as wrappers from './wrappers'
import * as vscode from 'vscode'
import * as path from 'path'
import { basename, dirname, relative } from 'path'
import * as async from './async'
import * as packages from './packages'
import * as autoproj from './autoproj'

export class Target
{
    private readonly _name: string;
    private readonly _path: string;

    constructor(name: string, path: string)
    {
        this._name = name;
        this._path = path;
    }

    get name(): string
    {
        return this._name;
    }

    get path(): string
    {
        return this._path;
    }
}

export class PreLaunchTaskProvider implements vscode.TaskProvider
{
    private readonly _context: context.Context;

    constructor(context: context.Context)
    {
        this._context = context;
    }

    static task(pkg: packages.Package, context: context.Context): vscode.Task
    {
        let task: vscode.Task;
        let ws = context.workspaces.folderToWorkspace.get(pkg.path)
        if (ws && pkg.type.id == packages.Type.fromType(packages.TypeList.OROGEN).id)
        {
            let target = context.getDebuggingTarget(pkg.path);
            if (target)
            {
                let taskName = "Run " + relative(ws.root, pkg.path);
                taskName = taskName + " (gdbserver)";

                let args = ['exec', 'rock-run', '--gui', '--gdbserver', '--conf-dir',
                    path.join(pkg.path, 'scripts'), target.name]
                task = this.createTask(taskName, null, ws, pkg.path, args);
            }
        }
        return task;
    }

    private static runAutoproj(ws: autoproj.Workspace, cwd: string, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: cwd })
    }

    private static createTask(name: string, group: vscode.TaskGroup, ws: autoproj.Workspace, cwd: string, args = []) {
        let definition = { type: 'rock', workspace: ws.root }
        let exec = this.runAutoproj(ws, cwd, ...args);
        let task = new vscode.Task(definition, name, 'rock', exec, []);
        task.group = group;
        return task;
    }

    async provideTasks(token?: vscode.CancellationToken): Promise<vscode.Task[]>
    {
        let pkg = await this._context.getSelectedPackage();
        let tasks = new Array<vscode.Task>();
        let task = PreLaunchTaskProvider.task(pkg, this._context)

        if (task)
            tasks.push(task);

        return tasks;
    }

    resolveTask(task: vscode.Task, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.Task>
    {
        return null;
    }
}