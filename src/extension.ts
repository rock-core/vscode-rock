'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as tasks from './tasks';
import * as status from './status';
import * as utils from './utils';
import * as wrappers from './wrappers';
import * as context from './context';
import * as autoproj from './autoproj';

let workspaces: autoproj.Workspaces;
let rockContext: context.Context;
let statusBar: status.StatusBar;
let taskProvider: tasks.Provider;
let wrapper: wrappers.VSCode;

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

function setupCommands()
{
    rockContext.extensionContext.subscriptions.push(vscode.commands.registerCommand(
        'rock.selectPackage', async _ => {
            await utils.choosePackage(rockContext);
            statusBar.updateSelectedPackage();
        }));
    rockContext.extensionContext.subscriptions.push(vscode.commands.registerCommand(
        'rock.buildPackage', async _ => {
            utils.buildSelectedPackage(rockContext, taskProvider);
        }));
    rockContext.extensionContext.subscriptions.push(vscode.commands.registerCommand(
        'rock.selectPackageType', async _ => {
            await utils.choosePackageType(rockContext);
            statusBar.update();
        }));
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(extensionContext: vscode.ExtensionContext) {
    workspaces = new autoproj.Workspaces;
    taskProvider = new tasks.Provider(workspaces);
    wrapper = new wrappers.VSCode;
    rockContext = new context.Context(extensionContext, wrapper, workspaces);
    statusBar = new status.StatusBar(rockContext, taskProvider);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', taskProvider));

    initilizeWorkspace();
    taskProvider.reloadTasks();
    setupEvents();
    setupCommands();

    // Add the status bar
    statusBar.update();
    extensionContext.subscriptions.push(statusBar);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
