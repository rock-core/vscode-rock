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
