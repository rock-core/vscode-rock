import * as vscode from 'vscode'
import * as context from './context'
import * as debug from './debug'
import * as tasks from './tasks'
import * as wrappers from './wrappers'
import * as autoproj from './autoproj'
import * as async from './async'
import { relative, basename, dirname } from 'path'

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
            let info = await this.packageInfo(path, context);
            let type = await this.packageType(path, context, info);
            switch (type.id)
            {
                case TypeList.CXX.id:
                    return new RockCXXPackage(info, context, this._vscode, this._taskProvider);
                case TypeList.RUBY.id:
                    return new RockRubyPackage(this._bridge, info, context, this._vscode, this._taskProvider);
                case TypeList.OROGEN.id:
                    return new RockOrogenPackage(this._bridge, info, context, this._vscode, this._taskProvider);
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

    private async packageInfo(path: string, context: context.Context): Promise<autoproj.Package>
    {
        const ws = context.getWorkspaceByPath(path);
        if (!ws)
            return this.nullPackageInfo(path);

        let wsInfo;
        try {
            wsInfo = await ws.info();
        }
        catch(err) {
            return this.nullPackageInfo(path);
        }

        let defs = wsInfo.packages.get(path);
        if (!defs) {
            let wsInfo = await ws.envsh();
            let defs = wsInfo.packages.get(path);
            if (defs) {
                return defs;
            }
            else {
                return this.nullPackageInfo(path);
            }
        }
        else {
            return defs;
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

abstract class RockPackage extends GenericPackage
{
    protected readonly _vscode: wrappers.VSCode;
    readonly info: autoproj.Package;

    get path() : string
    {
        return this.info.srcdir;
    }

    readonly debugable : boolean;
    private readonly _taskProvider: tasks.Provider;

    constructor(info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(context);
        this._vscode = vscode;
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
}

export class RockRubyPackage extends RockPackageWithTargetPicker
{
    private _bridge: async.EnvironmentBridge;

    constructor(bridge: async.EnvironmentBridge, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(info, context, vscode, taskProvider);
        this._bridge = bridge;
    }

    async preLaunchTask(): Promise<void>
    {
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        const debugTarget = this.debugTarget as debug.Target;
        return this._bridge.env(this.path).
            then(result => {
                    let userConf = this._context.debugConfig(this.path);
                    const options: vscode.DebugConfiguration = {
                        type: "Ruby",
                        name: "rock debug",
                        request: "launch",
                        program: debugTarget.path,
                        env: result,
                        cwd: userConf.cwd,
                        args: userConf.args
                    };
                    return options;
                });
    }
    get type() { return Type.fromType(TypeList.RUBY); }
}

export class RockCXXPackage extends RockPackageWithTargetPicker
{
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
    get type() { return Type.fromType(TypeList.CXX); }
}

async function sleep(ms: number): Promise<void>
{
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export class RockOrogenPackage extends RockPackage
{
    private _bridge: async.EnvironmentBridge;

    constructor(bridge: async.EnvironmentBridge, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(info, context, vscode, taskProvider);
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

    get type() { return Type.fromType(TypeList.OTHER); }
}