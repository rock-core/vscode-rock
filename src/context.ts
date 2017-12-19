import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';

export class PackageTypeList
{
    static CXX = { id: 0, name: 'cxx', label: 'C/C++', autobuild: [
        'Autobuild::CMake', 'Autobuild::Autotools'] };
    static RUBY = { id: 1, name: 'ruby', label: 'Ruby', autobuild: [
        'Autobuild::Ruby'] };
    static OROGEN = { id: 2, name: 'orogen', label: 'Orogen', autobuild: [
        'Autobuild::Orogen'] };
    static OTHER = { id: 3, name: 'other', label: 'Other', autobuild: new Array<string>() };

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
        let match = new PackageType(PackageTypeList.OTHER);
        PackageTypeList.allTypes.forEach(type => {
            if (type.name == name)
                match = new PackageType(type);
        });
        return match;
    }
    static fromId(id: number) {
        let match = new PackageType(PackageTypeList.OTHER);
        PackageTypeList.allTypes.forEach(type => {
            if (type.id == id)
                match = new PackageType(type);
        });
        return match;
    }
    static fromAutobuild(autobuildType: string) {
        let match = new PackageType(PackageTypeList.OTHER);
        PackageTypeList.allTypes.forEach(type => {
            if (type.autobuild.find((item) => { return (item == autobuildType) }))
                match = new PackageType(type);
        });
        return match;
    }
    static fromType(type: { id: number, name: string, label: string }) {
        let match = new PackageType(PackageTypeList.OTHER);
        PackageTypeList.allTypes.forEach(_type => {
            if (type == _type)
                match = new PackageType(type);
        });
        return match;
    }
}

export class Context
{
    private readonly _context: vscode.ExtensionContext;
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private _selectedPackageType = new Map<string, PackageType>();
    private _debuggingTarget = new Map<string, debug.Target>();

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

    public setSelectedPackageType(type: PackageType)
    {
        if (this.selectedPackage)
            this._selectedPackageType.set(this.selectedPackage.root, type);
    }

    public async getSelectedPackageType(): Promise<PackageType>
    {
        let selectedPackage = this.selectedPackage;
        if (!selectedPackage)
            return Promise.resolve(PackageType.fromType(PackageTypeList.OTHER));

        let type = this._selectedPackageType.get(selectedPackage.root);
        if (type)
            return Promise.resolve(type);

        let ws = this.workspaces.folderToWorkspace.get(selectedPackage.root);
        if (!ws)
            return Promise.resolve(PackageType.fromType(PackageTypeList.OTHER));

        let promise = new Promise<PackageType>((resolve, reject) => {
            ws.info().then((wsInfo) => {
                let relativePath = relative(ws.root, selectedPackage.root)
                let defs = wsInfo.packages.get(relativePath);
                if (!defs)
                {
                    resolve(PackageType.fromType(PackageTypeList.OTHER));
                }
                else
                {
                    type = PackageType.fromAutobuild(defs.type)
                    resolve(type)
                }
            }, (reason) => {
                resolve(PackageType.fromType(PackageTypeList.OTHER));
            });
        })
        return promise;
    }

    public set debuggingTarget(target: debug.Target)
    {
        if (this.selectedPackage)
            this._debuggingTarget.set(this.selectedPackage.root, target);
    }

    public get debuggingTarget(): debug.Target
    {
        if (!this.selectedPackage)
            return null;
        return this._debuggingTarget.get(this.selectedPackage.root);
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