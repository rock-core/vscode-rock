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
import * as config from './config';

function initializeWorkspacesFromVSCodeFolders(workspaces: autoproj.Workspaces,
    configManager: config.ConfigManager)
{
    if (vscode.workspace.workspaceFolders != undefined) {
        vscode.workspace.workspaceFolders.forEach((folder) => {
            if (workspaces.addFolder(folder.uri.fsPath)) {
                configManager.setupPackage(folder.uri.fsPath).catch((reason) => {
                    vscode.window.showErrorMessage(reason.message);
                });
            }
        });
    }
}

function setupEvents(rockContext: context.Context, extensionContext: vscode.ExtensionContext,
    workspaces: autoproj.Workspaces, statusBar: status.StatusBar, taskProvider: tasks.Provider,
    configManager: config.ConfigManager)
{
    rockContext.onUpdate(() => {
        statusBar.update();
    })
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach((folder) => {
                if (workspaces.addFolder(folder.uri.fsPath)) {
                    configManager.setupPackage(folder.uri.fsPath).catch((reason) => {
                        vscode.window.showErrorMessage(reason.message);
                    });
                }
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
    let vscodeWrapper = new wrappers.VSCode(extensionContext);
    let workspaces = new autoproj.Workspaces;
    let taskProvider = new tasks.Provider(workspaces);
    let bridge = new async.EnvironmentBridge();

    let rockContext = new context.Context(vscodeWrapper, workspaces,
        new packages.PackageFactory(vscodeWrapper, taskProvider, bridge));

    let statusBar = new status.StatusBar(extensionContext, rockContext);
    let configManager = new config.ConfigManager(workspaces);
    let rockCommands = new commands.Commands(rockContext, vscodeWrapper, configManager);
    let preLaunchTaskProvider = new debug.PreLaunchTaskProvider(rockContext, vscodeWrapper);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', taskProvider));

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('rock', preLaunchTaskProvider));

    initializeWorkspacesFromVSCodeFolders(workspaces, configManager);
    taskProvider.reloadTasks();
    setupEvents(rockContext, extensionContext, workspaces,
        statusBar, taskProvider, configManager);
    rockCommands.register();

    let cppDebugProvider = new debug.CXXConfigurationProvider(rockContext);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', cppDebugProvider));
    let rubyDebugProvider = new debug.RubyConfigurationProvider(rockContext);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('Ruby', rubyDebugProvider));

    statusBar.update();
    extensionContext.subscriptions.push(statusBar);
    extensionContext.subscriptions.push(rockContext);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
