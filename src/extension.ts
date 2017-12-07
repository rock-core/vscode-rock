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
        })
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
            let taskName = taskProvider.buildTaskName(rockContext.selectedPackage.root);
            vscode.commands.executeCommand("workbench.action.tasks.runTask",
                taskName);
        }));
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(extensionContext: vscode.ExtensionContext) {
    taskProvider = new tasks.Provider;
    workspaces = new autoproj.Workspaces;
    wrapper = new wrappers.VSCode;
    rockContext = new context.Context(extensionContext, wrapper, workspaces);
    statusBar = new status.StatusBar(rockContext);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', taskProvider));

    initilizeWorkspace();
    setupEvents();
    setupCommands();

    // Add the status bar
    statusBar.update();
    extensionContext.subscriptions.push(statusBar);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
