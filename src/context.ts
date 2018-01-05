import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative, dirname } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as tasks from './tasks';
import * as packages from './packages'
import * as async from './async'
import * as fs from 'fs'
import { join as joinPath } from 'path'

export interface PackageInternalData
{
    type: string | undefined;
    debuggingTarget: {
        name: string | undefined,
        path: string | undefined
    }
}

export interface RockOrogenDebugConfig
{
    start: boolean,
    gui: boolean,
    confDir: string | undefined
}

export interface RockDebugConfig
{
    cwd: string | undefined;
    args: string[],
    orogen: RockOrogenDebugConfig
}

const NullOrogenDebugConfig = {
    start: false,
    gui: false,
    confDir: undefined
};

const NullRockDebugConfig = {
    cwd: undefined,
    args: [],
    orogen: NullOrogenDebugConfig
};

/** Checks that a given filesystem path is registered in a list of workspace folders */
function exists(folders: vscode.WorkspaceFolder[], fsPath: string)
{
    return folders.find((item) => {
        return (item.uri.fsPath == fsPath);
    })
}

export class DebuggingTargetChoice implements vscode.QuickPickItem {
    label : string;
    description : string;
    targetName : string;
    targetFile : string;
};

export class Context
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _contextUpdatedEvent: vscode.EventEmitter<void>;
    private readonly _bridge: async.EnvironmentBridge;
    private _lastSelectedRoot: string | undefined;

    public constructor(vscodeWrapper: wrappers.VSCode,
                       workspaces: autoproj.Workspaces = new autoproj.Workspaces,
                       packageFactory : packages.PackageFactory | undefined = undefined,
                       bridge: async.EnvironmentBridge | undefined = undefined)
    {
        this._vscode = vscodeWrapper;
        this._workspaces = workspaces;
        this._contextUpdatedEvent = new vscode.EventEmitter<void>();
        if (!packageFactory) {
            let taskProvider = new tasks.Provider(workspaces);
            packageFactory = new packages.PackageFactory(taskProvider);
        }
        this._packageFactory = packageFactory;

        if (!bridge) {
            bridge = new async.EnvironmentBridge;
        }
        this._bridge = bridge;
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

    public setPackageType(path: string, type: packages.Type): void
    {
        let data = this.loadPersistedData(path);
        data.type = type.name;
        this.persistData(path, data);
        this._contextUpdatedEvent.fire();
    }

    public getPackageType(path: string): packages.Type | undefined
    {
        let pkgType: packages.Type | undefined;
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

    public getDebuggingTarget(path: string): debug.Target | undefined
    {
        let data = this.loadPersistedData(path);
        if (!data || !data.debuggingTarget ||
            !data.debuggingTarget.name || !data.debuggingTarget.path)
            return undefined;

        return new debug.Target(data.debuggingTarget.name,
            data.debuggingTarget.path);
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

    public get bridge(): async.EnvironmentBridge
    {
        return this._bridge;
    }

    public debugConfig(path: string): RockDebugConfig
    {
        let resource = vscode.Uri.file(path);
        let conf = this._vscode.getConfiguration('rock', resource).get('debug');
        if (conf) {
            return conf as RockDebugConfig;
        }
        else {
            return NullRockDebugConfig;
        }
    }

    private persistedDataPath(rootPath: string)
    {
        return joinPath(rootPath, '.vscode', 'rock.json');
    }

    private loadPersistedData(path: string): PackageInternalData
    {
        let data: PackageInternalData = {
            type: undefined,
            debuggingTarget: {
                name: undefined,
                path: undefined
            }
        }
        try
        {
            let dataPath = this.persistedDataPath(path);
            let jsonData = fs.readFileSync(dataPath, "utf8");
            Object.assign(data, JSON.parse(jsonData));
        }
        catch
        {
        }
        return data;
    }

    private persistData(path: string, data: PackageInternalData): void
    {
        let dataPath = this.persistedDataPath(path);
        let dataDir  = dirname(dataPath);
        let jsonData = JSON.stringify(data);
        let options = {
            mode: 0o644,
            flag: 'w'
        };
        if (!fs.existsSync(dataDir))
            fs.mkdirSync(dataDir, 0o755);

        fs.writeFileSync(dataPath, jsonData, options);
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

    public getWorkspaceFolder(path: string) {
        return this._vscode.getWorkspaceFolder(vscode.Uri.file(path));
    }

    public async pickPackageType(path : string) {
        let choices = packages.Type.typePickerChoices();
        let options: vscode.QuickPickOptions = {
            placeHolder: 'Select the package type'
        }

        const chosen = await this._vscode.showQuickPick(choices, options);
        if (chosen) {
            this.setPackageType(path, chosen.type);
        }
        return chosen;
    }

    public async pickDebuggingFile(path : string) {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(path)
        };

        const targetUri = await this._vscode.showOpenDialog(options);
        if (targetUri) {
            let target = new debug.Target(basename(targetUri[0].fsPath), targetUri[0].fsPath);
            this.setDebuggingTarget(path, target);
        }
    }

    public async pickDebuggingTarget(packagePath : string, choices : DebuggingTargetChoice[] | Thenable<DebuggingTargetChoice[]>, options, token) {
        const selected = await this._vscode.showQuickPick(choices, options, token);
        if (selected) {
            let target = new debug.Target(selected.targetName, selected.targetFile);
            this.setDebuggingTarget(packagePath, target);
            return target;
        }
    }

    public startDebugging(path : string, options) {
        let workspaceFolder = this.getWorkspaceFolder(path);
        this._vscode.startDebugging(workspaceFolder, options);
    }

    public runTask(task : vscode.Task) {
        this._vscode.executeCommand("workbench.action.tasks.runTask",
            task.source + ": " + task.name);
    }
}
