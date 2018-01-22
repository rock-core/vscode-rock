'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as tasks from './tasks';
import * as wrappers from './wrappers';
import * as context from './context';
import * as autoproj from './autoproj';
import * as commands from './commands';
import * as packages from './packages';
import * as async from './async';
import * as debug from './debug';
import * as config from './config';
import * as fs from 'fs';
import { join as joinpath } from 'path';

function registerNewWorkspaceFolder(
        path: string, workspaces: autoproj.Workspaces,
        configManager: config.ConfigManager) : void {

    workspaces.addFolder(path);
    configManager.setupPackage(path).catch((reason) => {
        vscode.window.showErrorMessage(reason.message);
    });
}

function handleNewWorkspaceFolder(
        path: string,
        rockContext : context.Context,
        workspaces: autoproj.Workspaces,
        configManager: config.ConfigManager) : void {

    let ws = autoproj.Workspace.fromDir(path, false);
    if (!ws) {
        return;
    }

    rockContext.ensureSyskitContextAvailable(ws).catch(() => {})
    registerNewWorkspaceFolder(path, workspaces, configManager);
}

function initializeWorkspacesFromVSCodeFolders(
    rockContext: context.Context,
    workspaces: autoproj.Workspaces,
    configManager: config.ConfigManager)
{
    if (vscode.workspace.workspaceFolders != undefined) {
        vscode.workspace.workspaceFolders.forEach((folder) => {
            handleNewWorkspaceFolder(folder.uri.fsPath, rockContext, workspaces, configManager);
        });
    }
}

function setupEvents(rockContext: context.Context, extensionContext: vscode.ExtensionContext,
    workspaces: autoproj.Workspaces, taskProvider: tasks.Provider,
    configManager: config.ConfigManager)
{
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach((folder) => {
                handleNewWorkspaceFolder(folder.uri.fsPath, rockContext, workspaces, configManager);
            });
            event.removed.forEach((folder) => {
                workspaces.deleteFolder(folder.uri.fsPath);
            });
            taskProvider.reloadTasks();
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
        new packages.PackageFactory(vscodeWrapper, bridge));

    let configManager = new config.ConfigManager(workspaces, vscodeWrapper);
    let rockCommands = new commands.Commands(rockContext, vscodeWrapper, configManager);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', taskProvider));

    initializeWorkspacesFromVSCodeFolders(rockContext, workspaces, configManager);
    taskProvider.reloadTasks();
    setupEvents(rockContext, extensionContext, workspaces,
        taskProvider, configManager);
    rockCommands.register();

    extensionContext.subscriptions.push(workspaces);

    let cppDebugProvider = new debug.CXXConfigurationProvider(rockContext);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', cppDebugProvider));
    let rubyDebugProvider = new debug.RubyConfigurationProvider(rockContext);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('Ruby', rubyDebugProvider));
    let orogenDebugProvider = new debug.OrogenConfigurationProvider(rockContext, bridge, vscodeWrapper);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('orogen', orogenDebugProvider));

    extensionContext.subscriptions.push(rockContext);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
