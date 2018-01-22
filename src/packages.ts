import * as vscode from 'vscode'
import * as context from './context'
import * as debug from './debug'
import * as tasks from './tasks'
import * as wrappers from './wrappers'
import * as autoproj from './autoproj'
import * as async from './async'
import * as fs from 'fs'
import * as child_process from 'child_process'
import { relative, basename, dirname, join as joinpath } from 'path'

export class TypeList
{
    static CXX = { id: 0, name: 'cxx', label: 'C/C++', autobuild: ['Autobuild::CMake', 'Autobuild::Autotools'] };
    static RUBY = { id: 1, name: 'ruby', label: 'Ruby', autobuild: ['Autobuild::Ruby'] };
    static OROGEN = { id: 2, name: 'orogen', label: 'Orogen', autobuild: ['Autobuild::Orogen'] };
    static OTHER = { id: 3, name: 'other', label: 'Other', autobuild: new Array<string>() };

    // For internal use only
    static INVALID = { id: 4, name: 'invalid', label: 'internal', autobuild: new Array<string>() };
    static CONFIG = { id: 5, name: 'config', label: 'internal', autobuild: new Array<string>() };

    static ALL_TYPES =
        [TypeList.CXX, TypeList.RUBY, TypeList.OROGEN, TypeList.OTHER, TypeList.INVALID, TypeList.CONFIG];

    static findType(callback)
    {
        let type = TypeList.ALL_TYPES.find(callback);
        if (type) {
            return type;
        }
        else {
            return TypeList.OTHER;
        }
    }
}

export class Type
{
    readonly id: number;
    readonly name: string;
    readonly label: string;

    private constructor(type: { id: number, name: string, label: string })
    {
        this.id = type.id;
        this.name = type.name;
        this.label = type.label;
    }

    isInternal() : boolean
    {
        return this.label === 'internal';
    }

    isValid() : boolean
    {
        return this.id != TypeList.INVALID.id;
    }

    static fromName(name: string) {
        let type = TypeList.findType(type => type.name == name);
        return new Type(type);
    }
    static fromId(id: number) {
        let type = TypeList.findType(type => type.id == id);
        return new Type(type);
    }
    static fromAutobuild(autobuildType: string) {
        let type = TypeList.findType(type => type.autobuild.find((item) => { return (item == autobuildType) }));
        return new Type(type);
    }
    static fromType(type: { id: number, name: string, label: string }) {
        let matchedType = TypeList.findType(_type => type == _type);
        return new Type(matchedType);
    }
    static invalid()
    {
        return new Type(TypeList.INVALID);
    }
    static config()
    {
        return new Type(TypeList.CONFIG);
    }

    static typePickerChoices() {
        let choices = new Array<{
            label: string,
            description: string,
            type: Type
        }>();

        TypeList.ALL_TYPES.forEach((_type) => {
            let type = Type.fromType(_type);
            if (!type.isInternal()) {
                choices.push({
                    label: type.label,
                    description: '',
                    type: type
                });
            }
        });

        return choices;
    }
}

export class PackageFactory
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _taskProvider: tasks.Provider;
    private readonly _bridge: async.EnvironmentBridge;
    constructor(vscode: wrappers.VSCode, taskProvider: tasks.Provider, bridge: async.EnvironmentBridge)
    {
        this._vscode = vscode;
        this._taskProvider = taskProvider;
        this._bridge = bridge;
    }

    async createPackage(path: string, context: context.Context): Promise<Package>
    {
        if (context.workspaces.isConfig(path))
        {
            return new ConfigPackage(path);
        }
        else if (!this._vscode.getWorkspaceFolder(path))
        {
            return new InvalidPackage();
        }
        else if (context.getWorkspaceByPath(path))
        {
            let { ws, info } = await this.packageInfo(path, context);
            if (!ws) {
                return new ForeignPackage(path, context);
            }

            let type = await this.packageType(path, context, info);
            switch (type.id)
            {
                case TypeList.CXX.id:
                    return new RockCXXPackage(ws, info, context, this._vscode, this._taskProvider);
                case TypeList.RUBY.id:
                    return new RockRubyPackage(this._bridge, ws, info, context, this._vscode, this._taskProvider);
                case TypeList.OROGEN.id:
                    return new RockOrogenPackage(this._bridge, ws, info, context, this._vscode, this._taskProvider);
                default:
                    return new RockOtherPackage(path, context, this._vscode, this._taskProvider);
            }
        }
        return new ForeignPackage(path, context);
    }

    static createInvalidPackage(): InvalidPackage
    {
        return new InvalidPackage();
    }

    private nullPackageInfo(path : string) : autoproj.Package {
        let result : autoproj.Package = {
            name: path,
            type: 'Unknown',
            vcs: { type: 'unknown', url: 'unknown', repository_id: 'unknown' },
            srcdir: path,
            builddir: path,
            logdir: path,
            prefix: path,
            dependencies: []
        };
        return result;
    }

    private async packageInfo(path: string, context: context.Context): Promise<{ ws: autoproj.Workspace | null, info: autoproj.Package}>
    {
        const ws = context.getWorkspaceByPath(path);
        if (!ws)
            return { ws: null, info: this.nullPackageInfo(path) };

        let wsInfo;
        try {
            wsInfo = await ws.info();
        }
        catch(err) {
            return { ws, info: this.nullPackageInfo(path) };
        }

        let defs = wsInfo.packages.get(path);
        if (!defs) {
            let wsInfo = await ws.envsh();
            let defs = wsInfo.packages.get(path);
            if (defs) {
                return { ws, info: defs };
            }
            else {
                return { ws, info: this.nullPackageInfo(path) };
            }
        }
        else {
            return { ws, info: defs };
        }
    }

    private async packageType(path: string, context : context.Context, packageInfo : autoproj.Package | undefined): Promise<Type>
    {
        let type = await context.getPackageType(path);
        if (type)
            return type;

        if (packageInfo) {
            return Type.fromAutobuild(packageInfo.type)
        }
        else {
            return Type.fromType(TypeList.OTHER);
        }
    }
}

export interface Package
{
    readonly debugable: boolean;
    readonly path: string;
    readonly name: string;
    readonly type: Type;

    readonly buildTask: vscode.Task | undefined;
    readonly debugTarget: debug.Target | undefined;

    debug(): Promise<void>
    build(): Promise<void>
    pickTarget(): Promise<void>
    pickType(): Promise<void>
    customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
}

abstract class GenericPackage implements Package
{
    abstract readonly path: string;
    abstract readonly debugable: boolean;
    abstract readonly type: Type;
    abstract readonly buildTask: vscode.Task | undefined;
    abstract readonly debugTarget: debug.Target | undefined;

    abstract debug(): Promise<void>
    abstract build(): Promise<void>
    abstract pickTarget(): Promise<void>
    abstract customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>

    protected readonly _context: context.Context;
    constructor(context: context.Context)
    {
        this._context = context;
    }

    get name() { return basename(this.path); }

    async pickType(): Promise<void>
    {
        this._context.pickPackageType(this.path);
    }
}

export abstract class RockPackage extends GenericPackage
{
    protected readonly _vscode: wrappers.VSCode;
    readonly ws: autoproj.Workspace;
    readonly info: autoproj.Package;

    get path() : string
    {
        return this.info.srcdir;
    }

    readonly debugable : boolean;
    private readonly _taskProvider: tasks.Provider;

    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(context);
        this._vscode = vscode;
        this.ws = ws;
        this.info = info;
        this.debugable = true;
        this._taskProvider = taskProvider;
    }

    abstract async debugConfiguration(): Promise<vscode.DebugConfiguration>;
    abstract async preLaunchTask(): Promise<void>;

    async debug()
    {
        if (!this.debugTarget)
            throw new Error("Select a debugging target before debugging")

        const options = await this.debugConfiguration();
        await this.preLaunchTask();
        this._vscode.startDebugging(this.path, options);
    }

    get buildTask()
    {
        return this._taskProvider.buildTask(this.path);
    }

    async build(): Promise<void>
    {
        this._vscode.runTask(this.buildTask);
    }

    get debugTarget()
    {
        return this._context.getDebuggingTarget(this.path);
    }
}

abstract class RockPackageWithTargetPicker extends RockPackage
{
    async pickTarget(): Promise<void>
    {
        this._context.pickDebuggingFile(this.path);
    }
}

export class InvalidPackage implements Package
{
    readonly debugable: boolean;
    readonly path: string;
    readonly buildTask: vscode.Task | undefined;
    readonly debugTarget: debug.Target | undefined;

    get name () { return '(Invalid package)' }

    async debug(): Promise<void>
    {
        throw new Error("Select a valid package before starting a debugging session");
    }

    async build(): Promise<void>
    {
        throw new Error("Select a valid package before building");
    }

    async pickTarget(): Promise<void>
    {
        throw new Error("Select a valid package before picking a debugging target");
    }

    async pickType(): Promise<void>
    {
        throw new Error("Select a valid package before picking the package type")
    }

    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Select a valid package before trying to create a debug configuration");
    }

    get type()
    {
        return Type.invalid();
    }
}

export class ConfigPackage implements Package
{
    readonly debugable: boolean;
    readonly path: string;
    readonly buildTask: vscode.Task | undefined;
    readonly debugTarget: debug.Target | undefined;

    constructor(path: string)
    {
        this.debugable = false;
        this.path = path;
    }

    get name() { return basename(this.path); }
    async debug(): Promise<void>
    {
        throw new Error("Debugging a configuration package is not possible");
    }

    async build(): Promise<void>
    {
        throw new Error("Building a configuration package is not possible");
    }

    async pickTarget(): Promise<void>
    {
        throw new Error("Setting a debugging target for a configuration package is not possible");
    }

    async pickType(): Promise<void>
    {
        throw new Error("Setting a type for a configuration package is not possible");
    }

    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Debug configurations are not available for configuration packages");
    }

    get type()
    {
        return Type.config();
    }
}

export class ForeignPackage extends GenericPackage
{
    readonly path: string;
    readonly debugable: boolean;
    readonly buildTask: vscode.Task | undefined;
    readonly debugTarget: debug.Target | undefined;

    constructor(path: string, context: context.Context)
    {
        super(context);
        this.path = path;
        this.debugable = false;
    }

    get type()
    {
        let type = this._context.getPackageType(this.path);
        if (type)
            return type;
        else
            return Type.fromType(TypeList.OTHER);
    }

    async debug(): Promise<void>
    {
        throw new Error("Debugging a package that is not part of an autoproj workspace is not available");
    }

    async build(): Promise<void>
    {
        throw new Error("Building a package that is not part of an autoproj workspace is not available");
    }

    async pickTarget(): Promise<void>
    {
        throw new Error("Setting a debugging target for a package that is not part of an autoproj workspace is not available");
    }

    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Debug configurations are not available for external packages");
    }
}

export class RockRubyPackage extends RockPackageWithTargetPicker
{
    private _bridge: async.EnvironmentBridge;

    constructor(bridge: async.EnvironmentBridge, ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(ws, info, context, vscode, taskProvider);
        this._bridge = bridge;
    }

    async preLaunchTask(): Promise<void>
    {
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        const debugTarget = this.debugTarget as debug.Target;
        let userConf = this._context.debugConfig(this.path);
        const options: vscode.DebugConfiguration = {
            type: "Ruby",
            name: "rock debug",
            request: "launch",
            program: debugTarget.path,
            cwd: userConf.cwd,
            args: userConf.args
        };
        return options;
    }

    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(this.path),
            openLabel: "Debug file"
        };
        const targetUri = await this._vscode.showOpenDialog(options);
        if (targetUri) {
            const debugConfig: vscode.DebugConfiguration = {
                type: "Ruby",
                name: relative(this.path, targetUri[0].fsPath),
                request: "launch",
                program: targetUri[0].fsPath
            };
            return debugConfig;
        }
    }
    get type() { return Type.fromType(TypeList.RUBY); }
}

export class RockCXXPackage extends RockPackage
{
    async listExecutables(path?: string): Promise<string[]> {
        let executables: string[] = [];
        const EXCLUDED_DIRS = [/^\./,
                               /^CMakeFiles$/];

        const EXCLUDED_FILES = [/^libtool$/,
                                /^config.status$/,
                                /^configure$/,
                                /(\.so\.)+(\d+\.)?(\d+\.)?(\d+)$/,
                                /\.so$/,
                                /\.sh$/,
                                /\.rb$/,
                                /\.py$/];

        if (!path) path = this.info.builddir;
        if (!fs.existsSync(path))
            throw new Error("Build directory does not exist. Did you build the package first?");

        const files = fs.readdirSync(path);
        for (let file of files) {
            const fullPath = joinpath(path, file);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(fullPath);
            }
            catch (e) {
                continue; // ignore files that can't be stat'ed (i.e broken symlinks)
            }
            if (stat.isDirectory()) {
                if (!EXCLUDED_DIRS.some(filter => filter.test(file))) {
                    executables = executables.concat(await this.listExecutables(fullPath));
                }
            } else if (stat.isFile()) {
                if (!EXCLUDED_FILES.some(filter => filter.test(file))) {
                    if (stat.mode & fs.constants.S_IXUSR) {
                        executables.push(fullPath);
                    }
                }
            }
        }
        return executables;
    }
    private async pickerChoices(): Promise<{ label: string, description: string, path: string }[]>
    {
        let choices: { label: string, description: string, path: string }[] = [];
        for (let choice of await this.listExecutables()) {
            choices.push({
                label: basename(choice),
                description: relative(this.info.builddir, dirname(choice)),
                path: choice
            });
        }
        return choices;
    }
    async pickExecutable(): Promise<string | undefined>
    {
        const tokenSource = new vscode.CancellationTokenSource();
        const choices = this.pickerChoices();
        let err;
        choices.catch((_err) => {
            err = _err;
            tokenSource.cancel();
        })

        const options: vscode.QuickPickOptions = {
            placeHolder: "Select an executable target to debug"
        }
        const selected = await this._vscode.showQuickPick(choices, options, tokenSource.token);
        tokenSource.dispose();

        if (selected) {
            return selected.path;
        } else if (err) {
            throw err;
        }
    }
    async pickTarget()
    {
        const targetPath = await this.pickExecutable();
        if (targetPath) {
            this._context.setDebuggingTarget(this.path,
                new debug.Target(basename(targetPath), targetPath));
        }
    }

    async preLaunchTask(): Promise<void>
    {
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        let userConf = this._context.debugConfig(this.path);
        let debugTarget = this.debugTarget as debug.Target;
        const options: vscode.DebugConfiguration = {
            type: "cppdbg",
            name: "rock debug",
            request: "launch",
            program: debugTarget.path,
            externalConsole: false,
            MIMode: "gdb",
            cwd: userConf.cwd,
            args: userConf.args,
            setupCommands: [
                {
                    description: "Enable pretty-printing for gdb",
                    text: "-enable-pretty-printing",
                    ignoreFailures: false
                }
            ]
        };
        return options;
    }

    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        const executable = await this.pickExecutable();
        if (executable) {
            let expandablePath = relative(this.info.builddir, executable);
            expandablePath = joinpath("${rock:buildDir}", expandablePath);
            const debugConfig: vscode.DebugConfiguration = {
                type: "cppdbg",
                name: relative(this.info.builddir, executable),
                request: "launch",
                program: expandablePath,
                MIMode: "gdb",
                cwd: "${rock:buildDir}",
                setupCommands: [
                    {
                        description: "Enable pretty-printing for gdb",
                        text: "-enable-pretty-printing",
                        ignoreFailures: false
                    }
                ]
            };
            return debugConfig;
        }
    }
    get type() { return Type.fromType(TypeList.CXX); }
}

async function sleep(ms: number): Promise<void>
{
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export class RockOrogenPackage extends RockPackage
{
    private _bridge: async.EnvironmentBridge;

    constructor(bridge: async.EnvironmentBridge, ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(ws, info, context, vscode, taskProvider);
        this._bridge = bridge;
    }

    async preLaunchTask(): Promise<void>
    {
        let preLaunchTask = await debug.PreLaunchTaskProvider.task(this, this._context, this._vscode);
        if (!preLaunchTask)
            return;
        this._vscode.runTask(preLaunchTask);
        await sleep(3000); // give some time for rock-run to finish loading
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        let userConf = this._context.debugConfig(this.path);
        let debugTarget = this.debugTarget as debug.Target;
        const options: vscode.DebugConfiguration = {
            type: "cppdbg",
            name: "rock debug",
            request: "launch",
            program: debugTarget.path,
            externalConsole: true,
            MIMode: "gdb",
            miDebuggerServerAddress: "localhost:30001",
            cwd: userConf.cwd,
            serverLaunchTimeout: 30000,
            setupCommands: [
                {
                    description: "Enable pretty-printing for gdb",
                    text: "-enable-pretty-printing",
                    ignoreFailures: false
                }
            ]
        };
        return options;
    }

    async pickTarget(): Promise<void>
    {
        let description = this._bridge.describeOrogenProject(this.path, this.name);
        let tokenSource = new vscode.CancellationTokenSource();

        let err;
        description.catch((_err) => {
            err = _err;
            tokenSource.cancel();
        })
        let promise = description.then(
            (result) => {
                let choices : context.DebuggingTargetChoice[] = [];
                result.forEach((task) => {
                    choices.push({
                        label: task.model_name,
                        description: '',
                        targetName: task.model_name,
                        targetFile: task.file
                    });
                });
                return choices;
            })

        let options: vscode.QuickPickOptions = {
            placeHolder: 'Select a task to debug' }

        await this._context.pickDebuggingTarget(this.path, promise, options, tokenSource.token);
        tokenSource.dispose();
        // Note: we know the promise is resolved at this point thanks to the
        // await on the target picker
        if (err) {
            throw err;
        }
    }
    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Not supported yet");
    }
    get type() { return Type.fromType(TypeList.OROGEN); }
}

export class RockOtherPackage extends GenericPackage
{
    protected readonly _vscode : wrappers.VSCode;
    readonly path: string;
    readonly debugable: boolean;
    readonly debugTarget: debug.Target | undefined;

    private readonly _taskProvider: tasks.Provider;
    constructor(path: string, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(context);
        this.path = path;
        this.debugable = false;
        this._vscode = vscode;
        this._taskProvider = taskProvider;
    }

    get buildTask()
    {
        return this._taskProvider.buildTask(this.path);
    }

    async build(): Promise<void>
    {
        this._vscode.runTask(this.buildTask);
    }

    async debug()
    {
        throw new Error("Set the package type before trying to debug this package");
    }

    async pickTarget(): Promise<void>
    {
        throw new Error("Set the package type before trying to debug this package");
    }
    async customDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Set the package type before creating a debug configuration");
    }
    get type() { return Type.fromType(TypeList.OTHER); }
}
