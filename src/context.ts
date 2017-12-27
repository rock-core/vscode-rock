import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as packages from './packages'
import * as async from './async'
import * as fs from 'fs'
import { join as joinPath } from 'path'

export interface PackageInternalData
{
    type: string;
    debuggingTarget: {
        name: string,
        path: string
    }
}

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

/** Checks that a given filesystem path is registered in a list of workspace folders */
function exists(folders: vscode.WorkspaceFolder[], fsPath: string)
{
    return folders.find((item) => {
        return (item.uri.fsPath == fsPath);
    })
}

export class Context
{
    private readonly _context: vscode.ExtensionContext;
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _contextUpdatedEvent: vscode.EventEmitter<void>;
    private readonly _bridge: async.EnvironmentBridge;
    private _lastSelectedRoot: string;

    public constructor(context: vscode.ExtensionContext,
                       wrapper: wrappers.VSCode, workspaces: autoproj.Workspaces,
                       packageFactory: packages.PackageFactory,
                       contextUpdatedEvent: vscode.EventEmitter<void>,
                       bridge: async.EnvironmentBridge)
    {
        this._context = context;
        this._vscode = wrapper;
        this._workspaces = workspaces;
        this._packageFactory = packageFactory;
        this._contextUpdatedEvent = contextUpdatedEvent;
        this._bridge = bridge;
    }

    public setPackageType(path: string, type: packages.Type): void
    {
        let data = this.loadPersistedData(path);
        data.type = type.name;
        this.persistData(path, data);
        this._contextUpdatedEvent.fire();
    }

    public getPackageType(path: string): packages.Type
    {
        let pkgType: packages.Type;
        let data = this.loadPersistedData(path);

        if (data.type)
            pkgType = packages.Type.fromName(data.type);

        return pkgType;
    }

    public setDebuggingTarget(path: string, target: debug.Target): void
    {
        let data = this.loadPersistedData(path);
        data.debuggingTarget.name = target.name;
        data.debuggingTarget.path = target.path;
        this.persistData(path, data);
        this._contextUpdatedEvent.fire();
    }

    public getDebuggingTarget(path: string): debug.Target
    {
        let data = this.loadPersistedData(path);
        if (!data || !data.debuggingTarget ||
            !data.debuggingTarget.name || !data.debuggingTarget.path)
            return undefined;

        return new debug.Target(data.debuggingTarget.name,
            data.debuggingTarget.path);
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
        this._contextUpdatedEvent.fire();
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

    private loadPersistedData(path: string): PackageInternalData
    {
        let dataPath = join(path, '.vscode', '.rock.json');
        let jsonData: string;
        let data: PackageInternalData = {
            type: undefined,
            debuggingTarget: {
                name: undefined,
                path: undefined
            }
        }
        try
        {
            jsonData = fs.readFileSync(dataPath, "utf8");
            Object.assign(data, JSON.parse(jsonData));
        }
        catch
        {
        }
        return data;
    }

    private persistData(path: string, data: PackageInternalData): void
    {
        let jsonData = JSON.stringify(data);
        let options = {
            mode: 0o644,
            flag: 'w'
        };
        if (!fs.existsSync(join(path, '.vscode')))
            fs.mkdirSync(join(path, '.vscode'), 0o755);

        fs.writeFileSync(join(path, '.vscode', '.rock.json'), jsonData, options);
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
