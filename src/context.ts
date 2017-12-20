import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as packages from './packages'

export class Context
{
    private readonly _context: vscode.ExtensionContext;
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _folderToPackageType: Map<string, packages.Type>;
    private readonly _folderToDebuggingTarget: Map<string, debug.Target>;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _eventEmitter: vscode.EventEmitter<void>;
    public constructor(context: vscode.ExtensionContext,
                       wrapper: wrappers.VSCode, workspaces: autoproj.Workspaces,
                       packageFactory: packages.PackageFactory,
                       eventEmitter: vscode.EventEmitter<void>)
    {
        this._context = context;
        this._vscode = wrapper;
        this._workspaces = workspaces;
        this._packageFactory = packageFactory;
        this._folderToDebuggingTarget = new Map<string, debug.Target>();
        this._folderToPackageType = new Map<string, packages.Type>();
        this._eventEmitter = eventEmitter;
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
        let folders = this._vscode.workspaceFolders;
        if (!folders || folders.length == 0) {
            return this._packageFactory.createPackage(null, this);
        }

        const selectionMode = this.packageSelectionMode;
        let root: string;

        if (selectionMode == "manual")
        {
            let exists = false;
            root = this.rockSelectedPackage;
            if (!root) return this._packageFactory.createPackage(null, this);

            this._vscode.workspaceFolders.forEach((entry) => {
                if (entry.uri.fsPath == root) {
                    exists = true;
                }
            });

            if (!exists) {
                return this._packageFactory.createPackage(null, this);
            }

            return this._packageFactory.createPackage(root, this);
        }

        const editor = this._vscode.activeTextEditor;
        if (!editor) {
            return this._packageFactory.createPackage(null, this);
        }

        const resource = editor.document.uri;
        if (resource.scheme === 'file') {
            const folder = this._vscode.getWorkspaceFolder(resource);
            if (!folder) {
                return this._packageFactory.createPackage(null, this);;
            } else {
                root = folder.uri.fsPath;
            }
        } else {
            return this._packageFactory.createPackage(null, this);;
        }
        return this._packageFactory.createPackage(root, this);
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

    private get rockSelectedPackage(): string
    {
        return this._context.workspaceState.get('rockSelectedPackage');
    }

    private set rockSelectedPackage(root: string)
    {
        this._context.workspaceState.update('rockSelectedPackage', root);
    }
}