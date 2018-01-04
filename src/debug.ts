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

    static task(pkg: packages.Package, context: context.Context): vscode.Task | undefined
    {
        let ws = context.workspaces.folderToWorkspace.get(pkg.path)
        if (!ws) {
            throw new Error("package not in a workspace");
        }

        if (pkg.type.id === packages.TypeList.OROGEN.id)
        {
            return this.orogenTask(ws, pkg, context);
        }
        else {
            return;
        }
    }
    static orogenTask(ws: autoproj.Workspace, pkg: packages.Package, context: context.Context): vscode.Task | undefined
    {
        let target = context.getDebuggingTarget(pkg.path);
        if (!target) {
            return;
        }

        let args = ['exec', 'rock-run'];
        let folder = context.vscode.getWorkspaceFolder(vscode.Uri.file(pkg.path)) as vscode.WorkspaceFolder;
        let taskName = "Run " + relative(ws.root, pkg.path);
        taskName = taskName + " (gdbserver)";

        let userConf = context.debugConfig(pkg.path);
        if (userConf.orogen.start) args.push('--start');
        if (userConf.orogen.gui) args.push('--gui');
        args.push('--gdbserver');
        if (userConf.orogen.confDir)
        {
            args.push('--conf-dir');
            args.push(userConf.orogen.confDir);
        }
        args.push(target.name);

        return this.createTask(taskName, folder, ws, userConf.cwd, args);
    }

    private static runAutoproj(ws: autoproj.Workspace, cwd: string | undefined, ...args) {
        return new vscode.ProcessExecution(ws.autoprojExePath(), args, { cwd: cwd })
    }

    private static createTask(name: string, target: vscode.WorkspaceFolder, ws: autoproj.Workspace, cwd: string | undefined, args : string[] = []) {
        let definition = { type: 'rock', workspace: ws.root }
        let exec = this.runAutoproj(ws, cwd, ...args);
        let folder = context
        let task = new vscode.Task(definition, target, name, 'rock', exec, []);
        return task;
    }

    async provideTasks(token?: vscode.CancellationToken): Promise<vscode.Task[]>
    {
        let pkg = await this._context.getSelectedPackage();
        if (!pkg.type.isValid()) {
            return [];
        }

        let task = PreLaunchTaskProvider.task(pkg, this._context)
        if (task) {
            return [task];
        }
        else {
            return [];
        }
    }

    resolveTask(task: vscode.Task, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.Task>
    {
        return null;
    }
}
