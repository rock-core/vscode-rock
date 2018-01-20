import * as context from './context'
import * as wrappers from './wrappers'
import * as vscode from 'vscode'
import * as fs from 'fs'
import { basename, dirname, relative, join as joinpath } from 'path'
import * as async from './async'
import * as packages from './packages'
import * as autoproj from './autoproj'
import * as child_process from 'child_process';

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
    private readonly _vscode: wrappers.VSCode;
    private readonly _context: context.Context;

    constructor(context: context.Context, vscode: wrappers.VSCode)
    {
        this._vscode  = vscode;
        this._context = context;
    }

    static task(pkg: packages.Package, context: context.Context, vscode: wrappers.VSCode): vscode.Task | undefined
    {
        let ws = context.workspaces.folderToWorkspace.get(pkg.path)
        if (!ws) {
            return;
        }

        if (pkg.type.id === packages.TypeList.OROGEN.id)
        {
            return this.orogenTask(ws, pkg, context, vscode);
        }
        else {
            return;
        }
    }
    static orogenTask(ws: autoproj.Workspace, pkg: packages.Package, context: context.Context, vscode: wrappers.VSCode): vscode.Task | undefined
    {
        let target = context.getDebuggingTarget(pkg.path);
        if (!target) {
            return;
        }

        let args = ['exec', 'rock-run'];
        let folder = vscode.getWorkspaceFolder(pkg.path) as vscode.WorkspaceFolder;
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

        let task = PreLaunchTaskProvider.task(pkg, this._context, this._vscode)
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

export class ConfigurationProvider implements vscode.DebugConfigurationProvider
{
    protected _context : context.Context;

    constructor(context : context.Context) {
        this._context = context;
    }

    provideDebugConfigurations(folder : vscode.WorkspaceFolder | undefined, token : vscode.CancellationToken | undefined) : vscode.ProviderResult<vscode.DebugConfiguration[]>
    {
        return [];
    }

    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        return config;
    }


    async resolvePackage(folder: vscode.WorkspaceFolder | undefined) : Promise<packages.RockPackage | undefined>
    {
        if (!folder) {
            return;
        }
        let pkg = await this._context.getPackageByPath(folder.uri.fsPath);
        if (pkg instanceof packages.RockPackage) {
            return pkg;
        }
    }

    async expandAutoprojPaths(which: (cmd: string) => Promise<string>, pkg: { srcdir: string, builddir: string, prefix: string }, value: string) {
        let whichReplacements = new Map<string, Promise<string>>();

        let replaced = value.replace(/\${rock:[a-zA-Z]+(?::[^}]+)?}/, (match) => {
            let mode = match.substring(7, match.length - 1)
            if (mode === "buildDir") {
                return pkg.builddir;
            }
            else if (mode === "srcDir") {
                return pkg.srcdir;
            }
            else if (mode === "prefixDir") {
                return pkg.prefix;
            }

            if (mode.substring(0, 5) === "which") {
                let toResolve = mode.substring(6, mode.length);
                whichReplacements.set(match, which(toResolve));
            }
            return match;
        });

        for (let [string, promise] of whichReplacements) {
            let s = await promise;
            replaced = value.replace(string, s);
        }
        return replaced;
    }
}

export class CXXConfigurationProvider extends ConfigurationProvider
{
    provideDebugConfigurations(folder : vscode.WorkspaceFolder | undefined, token : vscode.CancellationToken | undefined) : vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [];
    }

    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        let pkg = await this.resolvePackage(folder);
        if (!pkg) {
            return config;
        }

        let ws = pkg.ws;

        let debuggerPath = config.miDebuggerPath || config.MIMode;
        let stubScript = joinpath(__dirname, '..', '..', 'stubs', config.MIMode);

        config.miDebuggerPath = stubScript;
        if (!config.environment) {
            config.environment = [];
        }
        config.environment = config.environment.concat([
            { name: "VSCODE_ROCK_AUTOPROJ_PATH", value: ws.autoprojExePath() },
            { name: "VSCODE_ROCK_AUTOPROJ_DEBUGGER", value: debuggerPath },
            { name: 'AUTOPROJ_CURRENT_ROOT', value: ws.root }
        ])

        config.program = await this.expandAutoprojPaths((name) => ws.which(name), pkg.info, config.program)
        if (config.cwd) {
            config.cwd = await this.expandAutoprojPaths((name) => ws.which(name), pkg.info, config.cwd);
        }
        return config;
    }
}

export class RubyConfigurationProvider extends ConfigurationProvider
{
    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        let pkg = await this.resolvePackage(folder);
        if (!pkg) {
            return config;
        }
        let ws = pkg.ws;

        config.useBundler = true;
        config.pathToBundler = ws.autoprojExePath();
        if (!config.env) {
            config.env = {}
        }
        config.env.AUTOPROJ_CURRENT_ROOT = ws.root;

        config.program = await this.expandAutoprojPaths((name) => ws.which(name), pkg.info, config.program)
        if (config.cwd) {
            config.cwd = await this.expandAutoprojPaths((name) => ws.which(name), pkg.info, config.cwd);
        }
        return config;
    }
}

export class OrogenConfigurationProvider extends ConfigurationProvider
{
    private readonly _bridge: async.EnvironmentBridge;
    private readonly _vscode: wrappers.VSCode;
    constructor(context : context.Context, bridge: async.EnvironmentBridge,
        wrapper: wrappers.VSCode)
    {
        super(context);
        this._bridge = bridge;
        this._vscode = wrapper;
    }

    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        let pkg = await this.resolvePackage(folder);
        if (!pkg) {
            throw new Error("Cannot debug orogen packages not within an Autoproj workspace");
        }
        let ws = pkg.ws;
        let deploymentInfo = await this.deploymentInfo(pkg, config.task);
        if (!deploymentInfo)
        {
            throw new Error("Could not find the target task within this package");
        }
        let args: string[] = [];
        const deployAs = config.deployAs || pkg.name;
        const deploymentBaseName = basename(deploymentInfo.file);
        const deploymentLoggerName = `${deploymentBaseName}_Logger`;
        args.push(`--rename=${deploymentBaseName}:${deployAs}`);
        args.push(`--rename=${deploymentLoggerName}:${deployAs}_Logger`);

        const resolvedConfig: vscode.DebugConfiguration = {
            name: config.name,
            request: config.request,
            type: "cppdbg",
            program: deploymentInfo.file,
            args: args,
            cwd: pkg.info.builddir,
            stopAtEntry: false,
            setupCommands: [
                {
                    description: "Enable pretty-printing for gdb",
                    text: "-enable-pretty-printing",
                    ignoreFailures: false
                }
            ]
        };
        if (config.start || config.confDir) {
            this.setupTask(ws, deployAs, config.start, config.confDir).
                catch(err => {
                    this._vscode.showErrorMessage(err.message);
                    this._context.outputChannel.show();
                }
            );
        }
        return resolvedConfig;
    }
    private async deploymentInfo(pkg: packages.RockPackage,
        taskName: string): Promise<async.IOrogenTask | undefined>
    {
        const taskModel = `${pkg.name}::${taskName}`;
        let description = await this._bridge.describeOrogenProject(pkg.path, pkg.name);
        return description.find((task) => task.model_name == taskModel);
    }
    private setupTask(ws: autoproj.Workspace, name: string,
        start?: boolean, confDir?: string): Promise<void>
    {
        let options: child_process.SpawnOptions = { env: {} };
        let stubScript = joinpath(__dirname, '..', '..', 'stubs', "setup_task.rb");
        Object.assign(options.env, process.env);
        Object.assign(options.env, { AUTOPROJ_CURRENT_ROOT: ws.root });

        let args: string[] = ['exec', 'ruby', stubScript];
        if (start) args.push("--start");
        if (confDir) {
            args.push("--conf-dir");
            args.push(confDir);
        }
        args.push(name);
        let subprocess = child_process.spawn(ws.autoprojExePath(), args, options);
        subprocess.stdout.on('data', (buffer) => {
            this._context.outputChannel.append(buffer.toString());
        });
        subprocess.stderr.on('data', (buffer) => {
            this._context.outputChannel.append(buffer.toString());
        });
        return new Promise<void>((resolve, reject) => {
            subprocess.on('exit', (code, signal) => {
                if (code !== 0) {
                    reject(new Error(`Could not setup task`))
                }
                else {
                    resolve();
                }
            })
        })
    }
}
