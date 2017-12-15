import * as context from './context'
import * as wrappers from './wrappers'
import * as vscode from 'vscode'
import { basename, dirname } from 'path'
import * as async from './async'

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

export interface TargetPicker
{
    target: Target | undefined;
    show(): Promise<Target | undefined>;
}

export class TargetPickerFactory
{
    private readonly _vscode;
    constructor(vscode: wrappers.VSCode)
    {
        this._vscode = vscode;
    }

    createPicker(type: context.PackageType, path?: string): TargetPicker | undefined
    {
        switch (type.id) {
            case context.PackageTypeList.CXX.id:
                return new CXXTargetPicker(this._vscode, path);
            case context.PackageTypeList.RUBY.id:
                return new RubyTargetPicker(this._vscode, path);
            default:
                return undefined;
        }
    }
}

export class GenericTargetPicker implements TargetPicker
{
    private _target: Target | undefined;
    private readonly _vscode: wrappers.VSCode;
    private readonly _path: vscode.Uri;

    constructor(wrapper: wrappers.VSCode, path?: string)
    {
        this._vscode = wrapper;
        if (path)
            this._path = vscode.Uri.file(path);
    }

    async show(): Promise<Target | undefined>
    {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
        };
        if (this._path)
            options.defaultUri = this._path;

        const uri = await this._vscode.showOpenDialog(options);
        if (!uri)
            this._target = undefined;
        else
            this._target = new Target(basename(uri[0].fsPath), uri[0].fsPath);
        return this._target;
    }

    get target(): Target | undefined
    {
        return this._target;
    }
}

export class CXXTargetPicker extends GenericTargetPicker
{
}

export class RubyTargetPicker extends GenericTargetPicker
{
}

async function cXXConfiguration(target: Target, type: context.PackageType,
    cwd?: string): Promise<vscode.DebugConfiguration>
{
    const options: vscode.DebugConfiguration = {
        type: "cppdbg",
        name: "rock debug",
        request: "launch",
        program: target.path,
        externalConsole: false,
        MIMode: "gdb",
        cwd: cwd ? cwd : dirname(target.path),
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

async function rubyConfiguration(target: Target, type: context.PackageType,
    cwd?: string): Promise<vscode.DebugConfiguration>
{
    const options: vscode.DebugConfiguration = {
        type: "Ruby",
        name: "rock debug",
        request: "launch",
        program: target.path,
        env: await async.extractEnv(target.path),
        cwd: cwd ? cwd : dirname(target.path),
    };
    return options;
}

export class ConfigurationProvider
{
    configuration(target: Target, type: context.PackageType,
        cwd?: string): Promise<vscode.DebugConfiguration | undefined>
    {
        switch (type.id) {
            case context.PackageTypeList.CXX.id:
                return cXXConfiguration(target, type, cwd);
            case context.PackageTypeList.RUBY.id:
                return rubyConfiguration(target, type, cwd);
            default:
                return undefined;
        }
    }

    hasConfiguration(type: context.PackageType): boolean
    {
        switch (type.id) {
            case context.PackageTypeList.CXX.id:
                return true;
            case context.PackageTypeList.RUBY.id:
                return true;
            default:
                return false;
        }
    }
}