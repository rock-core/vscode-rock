import * as vscode from 'vscode'
import * as context from './context'
import * as debug from './debug'
import * as tasks from './tasks'
import * as wrappers from './wrappers'
import * as autoproj from './autoproj'
import * as syskit from './syskit'
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
    constructor(vscode: wrappers.VSCode)
    {
        this._vscode = vscode;
    }

    async createPackage(path: string, context: context.Context): Promise<Package>
    {
        if (context.workspaces.isConfig(path))
        {
            let ws = context.getWorkspaceByPath(path);
            return new ConfigPackage(path, ws!);
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
                    return new RockCXXPackage(ws, info, context, this._vscode);
                case TypeList.RUBY.id:
                    return new RockRubyPackage(ws, info, context, this._vscode);
                case TypeList.OROGEN.id:
                    return new RockOrogenPackage(ws, info, context, this._vscode);
                default:
                    return new RockOtherPackage(ws, info, context, this._vscode);
            }
        }
        return new ForeignPackage(path, context);
    }

    static createInvalidPackage(): InvalidPackage
    {
        return new InvalidPackage();
    }

    private nullPackageInfo(path : string, ws?: autoproj.Workspace) : autoproj.Package {
        let name: string;
        if (ws) {
            name = relative(ws.root, path);
        } else {
            name = basename(path);
        }
        let result : autoproj.Package = {
            name: name,
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
            return { ws, info: this.nullPackageInfo(path, ws) };
        }

        let defs = wsInfo.packages.get(path);
        if (!defs) {
            return { ws, info: this.nullPackageInfo(path, ws) };
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
    readonly workspace: autoproj.Workspace | undefined;

    debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
}

abstract class GenericPackage implements Package
{
    abstract readonly path: string;
    abstract readonly type: Type;
    abstract readonly name: string;
    abstract readonly workspace: autoproj.Workspace | undefined;
    abstract debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>

    protected readonly _context: context.Context;
    constructor(context: context.Context)
    {
        this._context = context;
    }
}

export abstract class RockPackage extends GenericPackage
{
    protected readonly _vscode: wrappers.VSCode;
    readonly workspace: autoproj.Workspace;
    readonly info: autoproj.Package;

    get path() : string
    {
        return this.info.srcdir;
    }

    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode)
    {
        super(context);
        this._vscode = vscode;
        this.workspace = ws;
        this.info = info;
    }
    get name() { return this.info.name; }
}

export class InvalidPackage implements Package
{
    readonly path: string;

    get name () { return '(Invalid package)' }
    get workspace() { return undefined; }
    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        return Promise.reject(new Error("Select a valid package before trying to create a debug configuration"));
    }

    get type()
    {
        return Type.invalid();
    }
}

export class ConfigPackage implements Package
{
    readonly path: string;
    readonly workspace: autoproj.Workspace;
    constructor(path: string, ws: autoproj.Workspace)
    {
        this.path = path;
        this.workspace = ws;
    }

    get name() { return basename(this.path); }
    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        return Promise.reject(new Error("Debug configurations are not available for configuration packages"));
    }

    get type()
    {
        return Type.config();
    }
}

export class ForeignPackage extends GenericPackage
{
    readonly path: string;

    constructor(path: string, context: context.Context)
    {
        super(context);
        this.path = path;
    }

    get type() { return Type.fromType(TypeList.OTHER); }
    get workspace() { return undefined; }
    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        return Promise.reject(new Error("Debug configurations are not available for external packages"));
    }
    get name() { return basename(this.path); }
}

export class RockRubyPackage extends RockPackage
{
    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode)
    {
        super(ws, info, context, vscode);
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        const targetUri = await this._context.pickFile(this.path);
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
    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        const executable = await this._context.pickExecutable(this.info.builddir);
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
    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        const deployment = await this._context.pickTask(this.workspace);
        if (!deployment) {
            return;
        }

        if (deployment.default_deployment_for) {
            let task_model_name = deployment.default_deployment_for
            const debugConfig: vscode.DebugConfiguration = {
                name: `orogen - ${task_model_name}`,
                type: "orogen",
                request: "launch",
                deploy: task_model_name,
                deployAs: 'task',
                cwd: '${workspaceRoot}',
                externalConsole: true,
                stopAtEntry: false
            };
            return debugConfig;
        }
        else {
            const debugConfig: vscode.DebugConfiguration = {
                name: `orogen - ${deployment.name}`,
                type: "orogen",
                request: "launch",
                deploy: deployment.name,
                cwd: '${workspaceRoot}',
                externalConsole: true,
                stopAtEntry: false
            };
            return debugConfig;
        }
    }
    get type() { return Type.fromType(TypeList.OROGEN); }
}

export class RockOtherPackage extends RockPackage
{
    constructor(ws: autoproj.Workspace, info: autoproj.Package, context: context.Context, vscode: wrappers.VSCode)
    {
        super(ws, info, context, vscode);
    }

    async debugConfiguration(): Promise<vscode.DebugConfiguration | undefined>
    {
        throw new Error("Cannot create debug configuration: package type unknown");
    }
    get type() { return Type.fromType(TypeList.OTHER); }
}
