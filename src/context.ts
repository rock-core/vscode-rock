import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as packages from './packages'
import * as async from './async'

export interface RockOrogenDebugConfig
{
    start: boolean,
    gui: boolean,
    confDir: string
}

export interface RockDebugConfig
{
    cwd: string;
    args: string[],
    orogen: RockOrogenDebugConfig
}

function exists(folders: vscode.WorkspaceFolder[], uri: string)
{
    return folders.find((item) => {
        return (item.uri.fsPath == uri);
    })
}

export class Context
{
    private readonly _context: vscode.ExtensionContext;
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _folderToPackageType: Map<string, packages.Type>;
    private readonly _folderToDebuggingTarget: Map<string, debug.Target>;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _eventEmitter: vscode.EventEmitter<void>;
    private readonly _bridge: async.EnvironmentBridge;
    private _lastSelectedRoot: string;

    public constructor(context: vscode.ExtensionContext,
                       wrapper: wrappers.VSCode, workspaces: autoproj.Workspaces,
                       packageFactory: packages.PackageFactory,
                       eventEmitter: vscode.EventEmitter<void>,
                       bridge: async.EnvironmentBridge)
    {
        this._context = context;
        this._vscode = wrapper;
        this._workspaces = workspaces;
        this._packageFactory = packageFactory;
        this._folderToDebuggingTarget = new Map<string, debug.Target>();
        this._folderToPackageType = new Map<string, packages.Type>();
        this._eventEmitter = eventEmitter;
        this._bridge = bridge;
    }

    public setPackageType(path: string, type: packages.Type): void
    {
        this._folderToPackageType.set(path, type);
        this._eventEmitter.fire();
    }

    public getPackageType(path: string): packages.Type
    {
        return this._folderToPackageType.get(path);
    }

    public setDebuggingTarget(path: string, target: debug.Target): void
    {
        this._folderToDebuggingTarget.set(path, target);
        this._eventEmitter.fire();
    }

    public getDebuggingTarget(path: string): debug.Target
    {
        return this._folderToDebuggingTarget.get(path);
    }

    public async getSelectedPackage(): Promise<packages.Package>
    {
        let selectedRoot: string;
        let folders = this._vscode.workspaceFolders;

        if (folders && folders.length > 0)
        {
            const selectionMode = this.packageSelectionMode;
            if (selectionMode == "manual")
            {
                let root = this.rockSelectedPackage;
                if (root)
                {
                    if (exists(folders, root))
                        selectedRoot = root;
                }
            } else
            {
                if (folders.length == 1 && folders[0].uri.scheme == 'file')
                    selectedRoot = folders[0].uri.fsPath;

                const editor = this._vscode.activeTextEditor;
                if (editor)
                {
                    const resource = editor.document.uri;
                    if (resource.scheme === 'file')
                    {
                        const folder = this._vscode.getWorkspaceFolder(resource);
                        if (folder)
                            selectedRoot = folder.uri.fsPath;
                    }
                }
            }
            if (!selectedRoot && exists(folders, this._lastSelectedRoot))
                selectedRoot = this._lastSelectedRoot;
        }
        this._lastSelectedRoot = selectedRoot;
        return this._packageFactory.createPackage(selectedRoot, this);
    }

    public setSelectedPackage(path: string): void
    {
        this.rockSelectedPackage = path;
        this._eventEmitter.fire();
    }

    public get packageSelectionMode(): string
    {
        return this._vscode.getConfiguration('rock').
            get('packageSelectionMode');
    }

    public get extensionContext(): vscode.ExtensionContext
    {
        return this._context;
    }

    public get vscode(): wrappers.VSCode
    {
        return this._vscode;
    }

    public get workspaces(): autoproj.Workspaces
    {
        return this._workspaces;
    }

    public get bridge(): async.EnvironmentBridge
    {
        return this._bridge;
    }

    public debugConfig(path: string): RockDebugConfig
    {
        let resource = vscode.Uri.file(path);
        return this._vscode.getConfiguration('rock', resource).get('debug');
    }

    private get rockSelectedPackage(): string
    {
        return this._context.workspaceState.get('rockSelectedPackage');
    }

    private set rockSelectedPackage(root: string)
    {
        this._context.workspaceState.update('rockSelectedPackage', root);
    }
}
