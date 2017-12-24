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
                let args = ['exec', 'rock-run'];
                let folder = context.vscode.getWorkspaceFolder(vscode.Uri.file(pkg.path));
                let taskName = "Run " + relative(ws.root, pkg.path);
                taskName = taskName + " (gdbserver)";

                let userConf = context.debugConfig(pkg.path);
                if (userConf.orogen.start) args.push('--start');
                if (userConf.orogen.gui) args.push('--gui');
                args.push('--gdbserver');
                args.push('--conf-dir');
                args.push(userConf.orogen.confDir);
                args.push(target.name);

                task = this.createTask(taskName, folder, ws, userConf.cwd, args);
            }
        }
        return task;
    }

    private static runAutoproj(ws: autoproj.Workspace, cwd: string, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: cwd })
    }

    private static createTask(name: string, target: vscode.WorkspaceFolder, ws: autoproj.Workspace, cwd: string, args = []) {
        let definition = { type: 'rock', workspace: ws.root }
        let exec = this.runAutoproj(ws, cwd, ...args);
        let folder = context
        let task = new vscode.Task(definition, target, name, 'rock', exec, []);
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
