'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as disposables from './disposables';
import * as tasks from './tasks';
import * as wrappers from './wrappers';
import * as context from './context';
import * as autoproj from './autoproj';
import * as commands from './commands';
import * as packages from './packages';
import * as debug from './debug';
import * as config from './config';
import * as fs from 'fs';
import { join as joinpath } from 'path';
import * as snippets from './snippets';
import * as watcher from './watcher';
import * as path from 'path'

export class Manager {
    private _rockContext : context.Context;
    private _workspaces : autoproj.Workspaces;
    private _taskProvider : tasks.AutoprojProvider;
    private _configManager : config.ConfigManager;
    private _fileWatcher : watcher.FileWatcher;

    constructor(rockContext : context.Context, workspaces : autoproj.Workspaces,
        taskProvider : tasks.AutoprojProvider, configManager : config.ConfigManager,
        fileWatcher : watcher.FileWatcher) {

        this._rockContext   = rockContext;
        this._workspaces    = workspaces;
        this._taskProvider  = taskProvider;
        this._configManager = configManager;
        this._fileWatcher   = fileWatcher;
    }

    watchManifest(ws : autoproj.Workspace) {
        let manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this._fileWatcher.startWatching(manifestPath, (filePath) => {
                ws.reload().catch(err => {
                        let errMsg = `Could not load installation manifest: ${err.message}`
                        vscode.window.showErrorMessage(errMsg);
                    }
                );
            });
        }
        catch (err) {
            vscode.window.showErrorMessage(err.message);
        }
    }

    unwatchManifest(ws : autoproj.Workspace) {
        let manifestPath = autoproj.installationManifestPath(ws.root);
        try {
            this._fileWatcher.stopWatching(manifestPath);
        }
        catch (err) {
            vscode.window.showErrorMessage(err.message);
        }
    }

    handleNewFolder(index: number, path: string) : number
    {
        let wsRoot = autoproj.findWorkspaceRoot(path);
        if (!wsRoot) {
            return index;
        }

        // Auto-add the workspace's autoproj folder
        let configIndex = commands.findAutoprojFolderIndex(
            this._rockContext.vscode.workspaceFolders as vscode.WorkspaceFolder[],
            { root: wsRoot });

        if (configIndex === undefined) {
            // Add the config folder just before this folder and return. vscode will
            // call us back for the config folder. This way, we also workaround the
            // VSCode < 1.30 behavior of restarting extensions when the first folder
            // is changed.
            commands.addAutoprojFolder(this._rockContext.vscode, wsRoot, index);
            return index + 1;
        }

        const { added, workspace } = this._workspaces.addFolder(path);
        if (added && workspace) {
            this.setupNewWorkspace(workspace);
        }
        this._configManager.setupPackage(path).catch((reason) => {
            vscode.window.showErrorMessage(reason.message);
        });
        return index;
    }

    setupNewWorkspace(workspace : autoproj.Workspace) {
        workspace.info().catch(err => {
            let errMsg = `Could not load installation manifest: ${err.message}`
            vscode.window.showErrorMessage(errMsg);
        })

        this._taskProvider.reloadTasks();
        workspace.ensureSyskitContextAvailable().catch(() => {})
        let watchTask = this._taskProvider.watchTask(workspace.root)
        vscode.tasks.executeTask(watchTask).
            then((execution) => {
                workspace.subscribe(disposables.forTask(execution))
            })
        this.watchManifest(workspace);
    }

    initializeWorkspaces(folders : vscode.WorkspaceFolder[]) {
        let index = 0;
        folders.forEach((folder) => {
            index = this.handleNewFolder(index, folder.uri.fsPath);
        });
        this._configManager.autoApplySettings();
    }

    handleDeletedFolder(path: string) {
        let deletedWs = this._workspaces.deleteFolder(path);
        this._taskProvider.reloadTasks();
        if (deletedWs) {
            this.unwatchManifest(deletedWs);
            deletedWs.dispose()
        }
    }

    handleWorkspaceChangeEvent(event : vscode.WorkspaceFoldersChangeEvent) {
        event.added.forEach((folder) => {
            this.handleNewFolder(folder.index, folder.uri.fsPath);
        });
        event.removed.forEach((folder) => {
            this.handleDeletedFolder(folder.uri.fsPath);
        });
        this._configManager.autoApplySettings();
    }
};
