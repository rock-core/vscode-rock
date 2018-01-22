import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative, dirname } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as tasks from './tasks';
import * as packages from './packages'
import * as fs from 'fs'
import { join as joinPath } from 'path'

export class Context
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _contextUpdatedEvent: vscode.EventEmitter<void>;
    private readonly _outputChannel: vscode.OutputChannel;
    private _pendingWorkspaceInit = new Map<autoproj.Workspace, Promise<void>>();
    private _verifiedSyskitContext = new Map<autoproj.Workspace, boolean>();

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

    public defaultBundlePath(ws : autoproj.Workspace) : string {
        return joinPath(ws.root, '.vscode', 'rock-default-bundle');
    }

    public hasValidSyskitContext(ws : autoproj.Workspace) : Promise<boolean> {
        // We do the cheap existence check even if the syskit context has been
        // verified. This would allow the user to "reset" the bundle by deleting
        // the bundle folder without having to restart VSCode, with a small
        // performance cost
        let bundlePath = this.defaultBundlePath(ws);
        if (!fs.existsSync(bundlePath)) {
            return Promise.resolve(false);
        }

        if (this._verifiedSyskitContext.get(ws)) {
            return Promise.resolve(true);
        }

        return ws.syskitCheckApp(bundlePath).
            then(() => {
                this._verifiedSyskitContext.set(ws, true);
                return true;
            }).
            catch(() => false);
    }

    public ensureSyskitContextAvailable(ws : autoproj.Workspace): Promise<void>
    {
        let pending = this._pendingWorkspaceInit.get(ws);
        if (pending) {
            return pending;
        }

        let p = this.hasValidSyskitContext(ws).then((result) => {
            if (result) {
                this._pendingWorkspaceInit.delete(ws)
            }
            else {
                let bundlePath = this.defaultBundlePath(ws);
                return ws.syskitGenApp(bundlePath).
                    then(
                        ()  => { this._pendingWorkspaceInit.delete(ws) },
                        (e) => { this._pendingWorkspaceInit.delete(ws); throw e; }
                    );
            }
        })

        this._pendingWorkspaceInit.set(ws, p);
        return p;
    }

    public getWorkspaceByPath(path : string) : autoproj.Workspace | undefined
    {
        return this.workspaces.folderToWorkspace.get(path);
    }

    public async getPackageByPath(path : string) : Promise<packages.Package>
    {
        return this._packageFactory.createPackage(path, this);
    }

    public get workspaces(): autoproj.Workspaces
    {
        return this._workspaces;
    }

    public async updateWorkspaceInfo(ws: autoproj.Workspace) {
        await ws.envsh();
        this._contextUpdatedEvent.fire();
    }
}
