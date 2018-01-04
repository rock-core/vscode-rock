import * as vscode from 'vscode'
import * as context from './context'
import * as status from './status'
import * as debug from './debug'
import * as tasks from './tasks'
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
    private readonly _taskProvider: tasks.Provider;
    constructor(taskProvider: tasks.Provider)
    {
        this._taskProvider = taskProvider;
    }

    async createPackage(path: string, context: context.Context): Promise<Package>
    {
        if (context.workspaces.isConfig(path))
        {
            return new ConfigPackage(path);
        }
        else if (!context.vscode.getWorkspaceFolder(vscode.Uri.file(path)))
        {
            return new InvalidPackage();
        }
        else if (context.workspaces.folderToWorkspace.has(path))
        {
            let type: Type = await this.packageType(path, context);
            switch (type.id)
            {
                case TypeList.CXX.id:
                    return new RockCXXPackage(path, context, this._taskProvider);
                case TypeList.RUBY.id:
                    return new RockRubyPackage(path, context, this._taskProvider);
                case TypeList.OROGEN.id:
                    return new RockOrogenPackage(path, context, this._taskProvider);
                default:
                    return new RockOtherPackage(path, context, this._taskProvider);
            }
        }
        return new ForeignPackage(path, context);
    }

    static createInvalidPackage(): InvalidPackage
    {
        return new InvalidPackage();
    }

    private async packageType(path: string, context: context.Context): Promise<Type>
    {
        let type = await context.getPackageType(path);
        if (type)
            return Promise.resolve(type);

        const ws = context.workspaces.folderToWorkspace.get(path);
        if (!ws)
            return Promise.resolve(Type.fromType(TypeList.OTHER));

        let wsInfo;
        try {
            wsInfo = await ws.info();
        }
        catch(err) {
            return Type.invalid();
        }

        const relativePath = relative(ws.root, path)
        let defs = wsInfo.packages.get(relativePath);
        if (!defs) {
            let wsInfo = await ws.envsh();
            return Type.fromType(TypeList.OTHER);
        }
        else {
            return Type.fromAutobuild(defs.type)
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
    abstract readonly debugable: boolean;
    abstract readonly type: Type;
    abstract readonly buildTask: vscode.Task | undefined;
    abstract readonly debugTarget: debug.Target | undefined;

    abstract debug(): Promise<void>
    abstract build(): Promise<void>
    abstract pickTarget(): Promise<void>

    readonly path: string;

    protected readonly _context: context.Context;
    constructor(path: string, context: context.Context)
    {
        this.path = path;
        this._context = context;
    }

    get name() { return basename(this.path); }

    async pickType(): Promise<void>
    {
        let choices = Type.typePickerChoices();
        let options: vscode.QuickPickOptions = {
            placeHolder: 'Select the package type' }

        const chosen = await this._context.vscode.showQuickPick(choices, options);
        if (chosen)
        {
            this._context.setPackageType(this.path, chosen.type);
        }
    }
}

abstract class RockPackage extends GenericPackage
{
    readonly debugable: boolean;
    private readonly _taskProvider: tasks.Provider;

    constructor(path: string, context: context.Context, taskProvider: tasks.Provider)
    {
        super(path, context);
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

        const uri = vscode.Uri.file(this.path);
        const folder = this._context.vscode.getWorkspaceFolder(uri);
        this._context.vscode.startDebugging(folder, options);
    }

    get buildTask()
    {
        return this._taskProvider.buildTask(this.path);
    }

    async build(): Promise<void>
    {
        this._context.vscode.executeCommand("workbench.action.tasks.runTask",
            this.buildTask.source + ": " + this.buildTask.name);
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
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(this.path)
        };

        const targetUri = await this._context.vscode.showOpenDialog(options);
        let target: debug.Target;
        if (targetUri)
        {
            target = new debug.Target(basename(targetUri[0].fsPath), targetUri[0].fsPath);
            this._context.setDebuggingTarget(this.path, target);
        }
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
    readonly debugable: boolean;
    readonly buildTask: vscode.Task | undefined;
    readonly debugTarget: debug.Target | undefined;

    constructor(path: string, context: context.Context)
    {
        super(path, context);
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
    async preLaunchTask(): Promise<void>
    {
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        const debugTarget = this.debugTarget as debug.Target;
        return this._context.bridge.env(this.path).
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

export interface IOrogenTaskPickerModel
{
    label: string,
    description: string,
    task: async.IOrogenTask
}

export class RockOrogenPackage extends RockPackage
{
    async preLaunchTask(): Promise<void>
    {
        let preLaunchTask = await debug.PreLaunchTaskProvider.task(this, this._context);
        if (!preLaunchTask)
            return;
        let preTaskName = preLaunchTask.source + ": " + preLaunchTask.name

        this._context.vscode.executeCommand("workbench.action.tasks.runTask", preTaskName);
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
        let description = this._context.bridge.describeOrogenProject(this.path, this.name);
        let tokenSource = new vscode.CancellationTokenSource();
        let promise = new Promise<IOrogenTaskPickerModel[]>((resolve, reject) => {
            description.then(
                async result => {
                    let choices = new Array<IOrogenTaskPickerModel>();
                    result.forEach((task) => {
                        choices.push({
                            label: task.model_name,
                            description: '',
                            task: task
                        });
                    });
                    resolve(choices);
                },
                err => {
                    tokenSource.cancel();
                    reject(err);
                }
            )
        });
        let options: vscode.QuickPickOptions = {
            placeHolder: 'Select a task to debug' }

        let contents;
        const targetTasks = await this._context.vscode.showQuickPick(promise, options, tokenSource.token);
        if (targetTasks)
        {
            let target = new debug.Target(targetTasks.task.model_name, targetTasks.task.file);
            this._context.setDebuggingTarget(this.path, target);
        }

        return new Promise<void>((resolve, reject) => {
            promise.then(sucess => {
                resolve();
            },
            err => {
                reject(err);
            })
        });
    }
    get type() { return Type.fromType(TypeList.OROGEN); }
}

export class RockOtherPackage extends GenericPackage
{
    readonly debugable: boolean;
    readonly debugTarget: debug.Target | undefined;

    private readonly _taskProvider: tasks.Provider;
    constructor(path: string, context: context.Context, taskProvider: tasks.Provider)
    {
        super(path, context);
        this.debugable = false;
        this._taskProvider = taskProvider;
    }

    get buildTask()
    {
        return this._taskProvider.buildTask(this.path);
    }

    async build(): Promise<void>
    {
        this._context.vscode.executeCommand("workbench.action.tasks.runTask",
            this.buildTask.source + ": " + this.buildTask.name);
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