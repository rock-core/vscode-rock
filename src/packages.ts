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
                    return new RockRubyPackage(ws, info, context, this._vscode, this._taskProvider);
                case TypeList.OROGEN.id:
                    return new RockOrogenPackage(this._bridge, ws, info, context, this._vscode, this._taskProvider);
                default:
                    return new RockOtherPackage(ws, info, context, this._vscode, this._taskProvider);
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
    readonly path: string;
    readonly name: string;
    readonly type: Type;

    readonly buildTask: vscode.Task | undefined;

    build(): Promise<void>
    debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
}

abstract class GenericPackage implements Package
{
    abstract readonly path: string;
    abstract readonly type: Type;
    abstract readonly buildTask: vscode.Task | undefined;

    abstract build(): Promise<void>
    abstract debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>

    protected readonly _context: context.Context;
    constructor(context: context.Context)
    {
        this._context = context;
    }

    get name() { return basename(this.path); }
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

    private readonly _taskProvider: tasks.Provider;

    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(context);
        this._vscode = vscode;
        this.ws = ws;
        this.info = info;
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
}

export class InvalidPackage implements Package
{
    readonly path: string;
    readonly buildTask: vscode.Task | undefined;

    get name () { return '(Invalid package)' }

    async build(): Promise<void>
    {
        throw new Error("Select a valid package before building");
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
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
    readonly path: string;
    readonly buildTask: vscode.Task | undefined;

    constructor(path: string)
    {
        this.path = path;
    }

    get name() { return basename(this.path); }
    async build(): Promise<void>
    {
        throw new Error("Building a configuration package is not possible");
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
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
    readonly buildTask: vscode.Task | undefined;

    constructor(path: string, context: context.Context)
    {
        super(context);
        this.path = path;
    }

    get type() { return Type.fromType(TypeList.OTHER); }
    async build(): Promise<void>
    {
        throw new Error("Building a package that is not part of an autoproj workspace is not available");
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Debug configurations are not available for external packages");
    }
}

export class RockRubyPackage extends RockPackage
{
    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(ws, info, context, vscode, taskProvider);
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
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

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
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

export class RockOrogenPackage extends RockPackage
{
    private _bridge: async.EnvironmentBridge;

    constructor(bridge: async.EnvironmentBridge, ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(ws, info, context, vscode, taskProvider);
        this._bridge = bridge;
    }

    async pickTask(): Promise<async.IOrogenTask | undefined>
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
                let choices: { label: string, description: string, task: async.IOrogenTask }[] = [];
                result.forEach((task) => {
                    choices.push({
                        label: task.model_name,
                        description: '',
                        task: task
                    });
                });
                return choices;
            }
        )
        let options: vscode.QuickPickOptions = {
            placeHolder: 'Select a task' }

        let task = await this._vscode.showQuickPick(promise, options, tokenSource.token);
        tokenSource.dispose();
        // Note: we know the promise is resolved at this point thanks to the
        // await on the target picker
        if (err) {
            throw err;
        }
        if (task)
        {
            return task.task;
        }
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        const task = await this.pickTask();
        if (task) {
            const debugConfig: vscode.DebugConfiguration = {
                name: task.model_name,
                type: "orogen",
                request: "launch",
                task: (task.model_name.split("::"))[1]
            };
            return debugConfig;
        }
    }
    get type() { return Type.fromType(TypeList.OROGEN); }
}

export class RockOtherPackage extends RockPackage
{
    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode, taskProvider: tasks.Provider)
    {
        super(ws, info, context, vscode, taskProvider);
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Cannot create debug configuration: package type unknown");
    }
    get type() { return Type.fromType(TypeList.OTHER); }
}
