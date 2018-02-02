import * as context from './context'
import * as wrappers from './wrappers'
import * as vscode from 'vscode'
import * as fs from 'fs'
import { basename, dirname, relative, join as joinpath } from 'path'
import * as packages from './packages'
import * as autoproj from './autoproj'
import * as child_process from 'child_process';
import * as syskit from './syskit';

export class ConfigurationProvider implements vscode.DebugConfigurationProvider
{
    protected _context : context.Context;

    constructor(context : context.Context) {
        this._context = context;
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
        if (pkg instanceof packages.RockPackage && pkg.type.id != packages.TypeList.OTHER.id) {
            return pkg;
        }
    }

    async expandAutoprojPaths(which: (cmd: string) => Promise<string>, pkg: { srcdir: string, builddir: string, prefix: string }, value: string) {
        let whichReplacements = new Map<string, Promise<string>>();

        let replaced = value.replace(/\${rock:[a-zA-Z]+(?::[^}]+)?}/g, (match) => {
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
            else {
                if (mode.substring(0, 5) === "which") {
                    let toResolve = mode.substring(6, mode.length);
                    whichReplacements.set(match, which(toResolve));
                }
                return match;
            }

        });

        for (let [string, promise] of whichReplacements) {
            let s = await promise;
            replaced = replaced.replace(string, s);
        }
        return replaced;
    }

    public async performExpansionsInObject<T>(object : T, expandFunction : (value: string) => Promise<string>) : Promise<T>
    {
        let result;
        if (object instanceof Array) {
            result = object.slice(0);
        }
        else {
            result = { ...<any>object };
        }
        let replacements : { key: string, resolver: Promise<string> }[] = []
        for (let key in <any>object) {
            let value = object[key];
            let resolver;
            if (typeof value === 'string') {
                resolver = expandFunction(value);
            }
            else if (typeof value === 'object') {
                resolver = this.performExpansionsInObject(value, expandFunction);
            }
            if (resolver) {
                replacements.push({ key: key, resolver: resolver })
            }
        }
        await Promise.all(replacements.map(async (entry) => {
            result[entry.key] = await entry.resolver;
        }))

        return <T>result;
    }
}

export class CXXConfigurationProvider extends ConfigurationProvider
{
    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        const pkg = await this.resolvePackage(folder);
        if (!pkg) {
            return config;
        }

        let ws = pkg.workspace;

        let debuggerPath = config.miDebuggerPath || config.MIMode;
        let stubScript = joinpath(__dirname, '..', '..', 'stubs', config.MIMode);

        config = await this.performExpansionsInObject(config,
            (value) => this.expandAutoprojPaths((name) => ws.which(name), pkg.info, value));

        config.miDebuggerPath = stubScript;
        if (!config.environment) {
            config.environment = [];
        }
        config.environment = config.environment.concat([
            { name: "VSCODE_ROCK_AUTOPROJ_PATH", value: ws.autoprojExePath() },
            { name: "VSCODE_ROCK_AUTOPROJ_DEBUGGER", value: debuggerPath },
            { name: 'AUTOPROJ_CURRENT_ROOT', value: ws.root }
        ])

        return config;
    }
}

export class RubyConfigurationProvider extends ConfigurationProvider
{
    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        const pkg = await this.resolvePackage(folder);
        if (!pkg) {
            return config;
        }
        let ws = pkg.workspace;

        config = await this.performExpansionsInObject(config,
            (value) => this.expandAutoprojPaths((name) => ws.which(name), pkg.info, value));
        config.useBundler = true;
        config.pathToBundler = ws.autoprojExePath();
        if (!config.env) {
            config.env = {}
        }
        config.env.AUTOPROJ_CURRENT_ROOT = ws.root;
        return config;
    }
}

export class OrogenConfigurationProvider extends CXXConfigurationProvider
{
    private readonly _vscode: wrappers.VSCode;
    constructor(context : context.Context, wrapper: wrappers.VSCode)
    {
        super(context);
        this._vscode = wrapper;
    }

    async resolveDebugConfiguration(folder : vscode.WorkspaceFolder | undefined, config : vscode.DebugConfiguration, token : vscode.CancellationToken | undefined) : Promise<vscode.DebugConfiguration>
    {
        const pkg = await this.resolvePackage(folder);
        if (!pkg) {
            throw new Error("Cannot debug orogen packages not within an Autoproj workspace");
        }

        let ws = pkg.workspace;
        let deployment;
        try {
            deployment = await this.deploymentCreate(
                pkg, config.deploy, config.deployAs)
        }
        catch(e) {
            if (e.name === "TaskNameRequired") {
                e.message = `${config.deploy} is a task model, the deployAs field is required`
            }
            throw e;
        }
        let commandLine = await this.deploymentCommandLine(pkg, deployment);

        config = await this.performExpansionsInObject(config,
            (value) => this.expandAutoprojPaths((name) => ws.which(name), pkg.info, value));

        config.type    = "cppdbg";
        config.program = commandLine.command;
        config.args    = commandLine.args;
        if (!config.cwd) {
            config.cwd     = commandLine.working_directory;
        }
        if (!config.MIMode) {
            config.MIMode = 'gdb';
        }
        if (!config.environment) {
            config.environment = []
        }
        for(let key in commandLine.env) {
            config.environment.push({ name: key, value: commandLine.env[key] })
        }
        
        if (config.start || config.confDir) {
            this.setupTask(ws, config.deployAs, config.start, config.confDir).
                catch(err => {
                    this._vscode.showErrorMessage(err.message);
                    this._context.outputChannel.show();
                }
            );
        }
        return super.resolveDebugConfiguration(folder, config, token);
    }
    private async deploymentCreate(pkg: packages.RockPackage,
        modelName: string, taskName: string)
    {
        let syskit = await pkg.workspace.
            syskitDefaultConnection();
        await syskit.clear();
        return syskit.registerDeployment(modelName, taskName)
    }
    private async deploymentCommandLine(pkg: packages.RockPackage, deployment : number) : Promise<syskit.CommandLine>
    {
        let syskit = await pkg.workspace.
            syskitDefaultConnection();
        return syskit.commandLine(deployment);
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
