import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative, dirname } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as tasks from './tasks';
import * as packages from './packages'
import * as fs from 'fs'
import { join as joinPath } from 'path'

/** Checks that a given filesystem path is registered in a list of workspace folders */
function exists(folders: vscode.WorkspaceFolder[], fsPath: string)
{
    return folders.find((item) => {
        return (item.uri.fsPath == fsPath);
    })
}

export class Context
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _contextUpdatedEvent: vscode.EventEmitter<void>;
    private _lastSelectedRoot: string | undefined;
    private readonly _outputChannel: vscode.OutputChannel;

    public constructor(vscodeWrapper: wrappers.VSCode,
                       workspaces: autoproj.Workspaces,
                       packageFactory : packages.PackageFactory)
    {
        this._vscode = vscodeWrapper;
        this._workspaces = workspaces;
        this._contextUpdatedEvent = new vscode.EventEmitter<void>();
        this._packageFactory = packageFactory;
        this._outputChannel = vscodeWrapper.createOutputChannel('Rock');
    }

    get outputChannel(): vscode.OutputChannel
    {
        return this._outputChannel;
    }

    public dispose() {
        this._contextUpdatedEvent.dispose();
    }

    public onUpdate(callback)
    {
        return this._contextUpdatedEvent.event(callback);
    }

    public isWorkspaceEmpty() : boolean {
        let folders = this._vscode.workspaceFolders;
        return (!folders || folders.length == 0);
    }

    public getWorkspaceByPath(path : string) : autoproj.Workspace | undefined
    {
        return this.workspaces.folderToWorkspace.get(path);
    }

    public async getPackageByPath(path : string) : Promise<packages.Package | undefined>
    {
        return this._packageFactory.createPackage(path, this);
    }

    public async getSelectedWorkspace() : Promise<autoproj.Workspace | undefined>
    {
        let pkg = await this.getSelectedPackage();
        if (!pkg.type.isValid()) {
            return;
        }
        return this.workspaces.getWorkspaceFromFolder(pkg.path);
    }

    public async getSelectedPackage(): Promise<packages.Package>
    {
        let selectedRoot: string | undefined;
        let folders = this._vscode.workspaceFolders;

        if (folders && folders.length > 0)
        {
            const selectionMode = this.packageSelectionMode;
            if (selectionMode == "manual") {
                let root = this.rockSelectedPackage;
                if (root)
                {
                    if (exists(folders, root))
                        selectedRoot = root;
                }
            }
            else {
                if (folders.length == 1 && folders[0].uri.scheme == 'file')
                    selectedRoot = folders[0].uri.fsPath;

                const currentDocumentURI = this._vscode.activeDocumentURI;
                if (currentDocumentURI && currentDocumentURI.scheme === 'file') {
                    const folder = this._vscode.getWorkspaceFolder(currentDocumentURI);
                    if (folder)
                        selectedRoot = folder.uri.fsPath;
                }
            }
            if (!selectedRoot && this._lastSelectedRoot && exists(folders, this._lastSelectedRoot))
                selectedRoot = this._lastSelectedRoot;
        }
        this._lastSelectedRoot = selectedRoot;
        if (selectedRoot) {
            return this._packageFactory.createPackage(selectedRoot, this);
        }
        else {
            return packages.PackageFactory.createInvalidPackage();
        }
    }

    public setSelectedPackage(path: string): void
    {
        this.rockSelectedPackage = path;
        this._contextUpdatedEvent.fire();
    }

    public get packageSelectionMode(): string | undefined
    {
        return this._vscode.getConfiguration('rock').
            get('packageSelectionMode');
    }

    public get workspaces(): autoproj.Workspaces
    {
        return this._workspaces;
    }

    private get rockSelectedPackage(): string | undefined
    {
        return this._vscode.getWorkspaceState('rockSelectedPackage');
    }

    private set rockSelectedPackage(root: string | undefined)
    {
        this._vscode.updateWorkspaceState('rockSelectedPackage', root);
    }

    public async updateWorkspaceInfo() {
        let ws = await this.getSelectedWorkspace();
        if (ws) {
            await ws.envsh();
            this._contextUpdatedEvent.fire();
        }
    }
}
