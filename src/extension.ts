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

let workspaces: autoproj.Workspaces;
let rockContext: context.Context;
let statusBar: status.StatusBar;
let taskProvider: tasks.Provider;
let wrapper: wrappers.VSCode;
let rockCommands: commands.Commands;
let packageFactory: packages.PackageFactory;
let onContextUpdate: vscode.EventEmitter<void>;

function initilizeWorkspace()
{
    if (vscode.workspace.workspaceFolders != undefined) {
        vscode.workspace.workspaceFolders.forEach((folder) => {
            workspaces.addFolder(folder.uri.fsPath);
        });
    }
}

function setupEvents()
{
    onContextUpdate.event(() => {
        statusBar.update();
    })
    rockContext.extensionContext.subscriptions.push(
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
    onContextUpdate = new vscode.EventEmitter<void>();
    workspaces = new autoproj.Workspaces;
    taskProvider = new tasks.Provider(workspaces);
    wrapper = new wrappers.VSCode;
    packageFactory = new packages.PackageFactory(taskProvider); 
    rockContext = new context.Context(extensionContext, wrapper,
        workspaces, packageFactory, onContextUpdate);
    statusBar = new status.StatusBar(rockContext);
    rockCommands = new commands.Commands(rockContext);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', taskProvider));

    initilizeWorkspace();
    taskProvider.reloadTasks();
    setupEvents();
    rockCommands.register();

    statusBar.update();
    extensionContext.subscriptions.push(statusBar);
    extensionContext.subscriptions.push(onContextUpdate);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
