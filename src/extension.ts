'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as tasks from './tasks';
import * as status from './status';
import * as wrappers from './wrappers';
import * as context from './context';
import * as autoproj from './autoproj';
import * as commands from './commands';
import * as packages from './packages';
import * as async from './async';
import * as debug from './debug';

function initializeWorkspacesFromVSCodeFolders(workspaces)
{
    if (vscode.workspace.workspaceFolders != undefined) {
        vscode.workspace.workspaceFolders.forEach((folder) => {
            workspaces.addFolder(folder.uri.fsPath);
        });
    }
}

function setupEvents(onContextUpdate, extensionContext, workspaces, statusBar, taskProvider)
{
    onContextUpdate.event(() => {
        statusBar.update();
    })
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach((folder) => {
                workspaces.addFolder(folder.uri.fsPath);
            });
            event.removed.forEach((folder) => {
                workspaces.deleteFolder(folder.uri.fsPath);
            });
            taskProvider.reloadTasks();
            statusBar.update();
        })
    );
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(extensionContext: vscode.ExtensionContext) {
    let envBridge = new async.EnvironmentBridge;
    let onContextUpdate = new vscode.EventEmitter<void>();
    let workspaces = new autoproj.Workspaces;
    let taskProvider = new tasks.Provider(workspaces);
    let vscodeWrapper = new wrappers.VSCode();
    let packageFactory = new packages.PackageFactory(taskProvider); 
    let rockContext = new context.Context(extensionContext, vscodeWrapper,
            workspaces, packageFactory, onContextUpdate, envBridge);
    let statusBar = new status.StatusBar(rockContext);
    let rockCommands = new commands.Commands(rockContext);
    let preLaunchTaskProvider = new debug.PreLaunchTaskProvider(rockContext);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', taskProvider));

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('rock', preLaunchTaskProvider));

    initializeWorkspacesFromVSCodeFolders(workspaces);
    taskProvider.reloadTasks();
    setupEvents(onContextUpdate, extensionContext, workspaces, statusBar, taskProvider);
    rockCommands.register();

    statusBar.update();
    extensionContext.subscriptions.push(statusBar);
    extensionContext.subscriptions.push(onContextUpdate);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
