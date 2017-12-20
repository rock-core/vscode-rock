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
    static INVALID = { id: 4, name: undefined, label: undefined, autobuild: new Array<string>() };
    static CONFIG = { id: 5, name: undefined, label: undefined, autobuild: new Array<string>() };

    private constructor() { }
    static get allTypes()
    {
        return [this.CXX,
                this.RUBY,
                this.OROGEN,
                this.OTHER];
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

    static fromName(name: string) {
        let match = new Type(TypeList.OTHER);
        TypeList.allTypes.forEach(type => {
            if (type.name == name)
                match = new Type(type);
        });
        return match;
    }
    static fromId(id: number) {
        let match = new Type(TypeList.OTHER);
        TypeList.allTypes.forEach(type => {
            if (type.id == id)
                match = new Type(type);
        });
        return match;
    }
    static fromAutobuild(autobuildType: string) {
        let match = new Type(TypeList.OTHER);
        TypeList.allTypes.forEach(type => {
            if (type.autobuild.find((item) => { return (item == autobuildType) }))
                match = new Type(type);
        });
        return match;
    }
    static fromType(type: { id: number, name: string, label: string }) {
        let match = new Type(TypeList.OTHER);
        TypeList.allTypes.forEach(_type => {
            if (type == _type)
                match = new Type(type);
        });
        return match;
    }
    static invalid()
    {
        return new Type(TypeList.INVALID);
    }
    static config()
    {
        return new Type(TypeList.CONFIG);
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
        if (!path)
        {
            return new InvalidPackage();
        }
        else if (context.workspaces.isConfig(path))
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

    private async packageType(path: string, context: context.Context): Promise<Type>
    {
        let type = await context.getPackageType(path);
        if (type)
            return Promise.resolve(type);

        let ws = context.workspaces.folderToWorkspace.get(path);
        if (!ws)
            return Promise.resolve(Type.fromType(TypeList.OTHER));

        let promise = new Promise<Type>((resolve, reject) => {
            ws.info().then((wsInfo) => {
                let relativePath = relative(ws.root, path)
                let defs = wsInfo.packages.get(relativePath);
                if (!defs)
                {
                    resolve(Type.fromType(TypeList.OTHER));
                }
                else
                {
                    type = Type.fromAutobuild(defs.type)
                    resolve(type)
                }
            }, (reason) => {
                resolve(Type.fromType(TypeList.OTHER));
            });
        })
        return promise;
    }
}

export interface Package
{
    readonly debugable: boolean;
    readonly buildTask: vscode.Task;
    readonly path: string;
    readonly target: debug.Target;
    readonly name: string;
    readonly type: Type;

    debug(): Promise<void>
    build(): Promise<void>
    pickTarget(): Promise<void>
    pickType(): Promise<void>
}

abstract class GenericPackage implements Package
{
    abstract readonly debugable: boolean;
    abstract readonly buildTask: vscode.Task;
    abstract readonly target: debug.Target;
    abstract readonly type: Type;

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
        let choices = new Array<{
            label: string,
            description: string,
            type: Type
        }>();

        TypeList.allTypes.forEach((type) => {
            choices.push({
                label: type.label,
                description: '',
                type: type
            });
        });

        const chosen = await this._context.vscode.showQuickPick(choices);
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

    async debug()
    {
        if (!this.target)
            throw new Error("Select a debugging target before debugging")

        const options = await this.debugConfiguration();

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

    get target()
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
    readonly buildTask: vscode.Task;
    readonly path: string;
    readonly target: debug.Target;

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
    readonly buildTask: vscode.Task;
    readonly path: string;
    readonly target: debug.Target;

    constructor(path: string)
    {
        this.debugable = false;
        this.buildTask = undefined;
        this.path = path;
        this.target = undefined;
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
    readonly buildTask: vscode.Task;
    readonly target: debug.Target;

    constructor(path: string, context: context.Context)
    {
        super(path, context);
        this.debugable = false;
        this.buildTask = undefined;
        this.target = undefined;
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
    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        const options: vscode.DebugConfiguration = {
            type: "Ruby",
            name: "rock debug",
            request: "launch",
            program: this.target.path,
            env: await async.extractEnv(this.path),
            cwd: dirname(this.target.path),
        };
        return options;
    }
    get type() { return Type.fromType(TypeList.RUBY); }
}

export class RockCXXPackage extends RockPackageWithTargetPicker
{
    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        const options: vscode.DebugConfiguration = {
            type: "cppdbg",
            name: "rock debug",
            request: "launch",
            program: this.target.path,
            externalConsole: false,
            MIMode: "gdb",
            cwd: dirname(this.target.path),
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

export class RockOrogenPackage extends RockPackageWithTargetPicker
{
    async debugConfiguration(): Promise<vscode.DebugConfiguration>
    {
        return undefined;
    }

    async debug()
    {
        throw new Error("Debugging Orogen packages is not supported yet");
    }
    async pickTarget()
    {
        throw new Error("Debugging Orogen packages is not supported yet")
    }
    get type() { return Type.fromType(TypeList.OROGEN); }
}

export class RockOtherPackage extends GenericPackage
{
    readonly debugable: boolean;
    readonly target: debug.Target;

    private readonly _taskProvider: tasks.Provider;
    constructor(path: string, context: context.Context, taskProvider: tasks.Provider)
    {
        super(path, context);
        this.debugable = false;
        this.target = undefined;
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