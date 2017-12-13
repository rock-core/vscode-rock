import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename } from 'path';
import * as autoproj from './autoproj';

export class Context
{
    private readonly _context: vscode.ExtensionContext;
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;

    public constructor(context: vscode.ExtensionContext,
                       wrapper: wrappers.VSCode, workspaces: autoproj.Workspaces)
    {
        this._context = context;
        this._vscode = wrapper;
        this._workspaces = workspaces;
    }

    public get selectedPackage(): { name:string, root:string }
    {
        let folders = this._vscode.workspaceFolders;
        if (!folders || folders.length == 0) {
            return null;
        }
    
        const selectionMode = this.packageSelectionMode;
        let name: string;
        let root: string;

        if (selectionMode == "manual")
        {
            let exists = false;
            root = this.rockSelectedPackage;
            if (!root) return null;
    
            this._vscode.workspaceFolders.forEach((entry) => {
                if (entry.uri.fsPath == root) {
                    exists = true;
                }
            });
    
            if (!exists) {
                return null;
            }
    
            name = basename(root);
            return { name, root }
        }
    
        const editor = this._vscode.activeTextEditor;        
        if (!editor) {
            return null;
        }
    
        const resource = editor.document.uri;
        if (resource.scheme === 'file') {
            const folder = this._vscode.getWorkspaceFolder(resource);
            if (!folder) {
                return null;
            } else {
                name = `${basename(folder.uri.fsPath)}`;
                root = folder.uri.fsPath;
            }
        } else {
            return null;
        }
        return { name, root };
    }

    public set selectedPackage({ name, root })
    {
        this.rockSelectedPackage = root;
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