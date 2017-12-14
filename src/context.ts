import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename } from 'path';
import * as autoproj from './autoproj';

export class PackageTypeList
{
    static CXX = { id: 0, name: 'cxx', label: 'C/C++' };
    static RUBY = { id: 1, name: 'ruby', label: 'Ruby' };
    static OROGEN = { id: 2, name: 'orogen', label: 'oroGen' };
    static OTHER = { id: 3, name: 'other', label: 'Other' };

    private constructor() { }
    static get allTypes()
    {
        return [this.CXX, this.RUBY, this.OROGEN, this.OTHER];
    }
}

export class PackageType
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
        PackageTypeList.allTypes.forEach(type => {
            if (type.name == name)
                return new PackageType(type);
        });
        return new PackageType(PackageTypeList.OTHER);
    }
    static fromId(id: number) {
        PackageTypeList.allTypes.forEach(type => {
            if (type.id == id)
                return new PackageType(type);
        });
        return new PackageType(PackageTypeList.OTHER);
    }
    static fromType(type: { id: number, name: string, label: string }) {
        PackageTypeList.allTypes.forEach(_type => {
            if (type == _type)
                return new PackageType(type);
        });
        return new PackageType(PackageTypeList.OTHER);
    }
}

export class Context
{
    private readonly _context: vscode.ExtensionContext;
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private _selectedPackageType: PackageType;

    public constructor(context: vscode.ExtensionContext,
                       wrapper: wrappers.VSCode, workspaces: autoproj.Workspaces)
    {
        this._context = context;
        this._vscode = wrapper;
        this._workspaces = workspaces;
        this._selectedPackageType = PackageType.fromType(PackageTypeList.OTHER);
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

    public set selectedPackageType(type: PackageType)
    {
        this._selectedPackageType = type;
    }

    public get selectedPackageType(): PackageType
    {
        if (!this.selectedPackage)
            return PackageType.fromType(PackageTypeList.OTHER);
        return this._selectedPackageType;
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