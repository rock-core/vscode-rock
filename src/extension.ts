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
import * as debug from './debug';
import * as config from './config';
import * as fs from 'fs';
import { join as joinpath } from 'path';
import * as snippets from './snippets';
import * as watcher from './watcher';
import * as path from 'path'

function watchManifest(ws: autoproj.Workspace, fileWatcher: watcher.FileWatcher)
{
    let manifestPath = autoproj.installationManifestPath(ws.root);
    try {
        fileWatcher.startWatching(manifestPath, (filePath) => {
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

function unwatchManifest(ws: autoproj.Workspace, fileWatcher: watcher.FileWatcher)
{
    let manifestPath = autoproj.installationManifestPath(ws.root);
    try {
        fileWatcher.stopWatching(autoproj.installationManifestPath(ws.root));
    }
    catch (err) {
        vscode.window.showErrorMessage(err.message);
    }
}

function handleNewWorkspaceFolder(
        path: string,
        rockContext : context.Context,
        workspaces: autoproj.Workspaces,
        configManager: config.ConfigManager,
        fileWatcher: watcher.FileWatcher) : void
{
    let { added, workspace } = workspaces.addFolder(path);
    if (added && workspace) {
        workspace.info().catch(err => {
                let errMsg = `Could not load installation manifest: ${err.message}`
                vscode.window.showErrorMessage(errMsg);
        })
        workspace.ensureSyskitContextAvailable().catch(() => {})
        vscode.commands.executeCommand('workbench.action.tasks.runTask', `autoproj: ${workspace.name}: Watch`)
        watchManifest(workspace, fileWatcher);
    } else if (workspace) {
        configManager.setupPackage(path).catch((reason) => {
            vscode.window.showErrorMessage(reason.message);
        });
    }
}

function initializeWorkspacesFromVSCodeFolders(
    rockContext: context.Context,
    workspaces: autoproj.Workspaces,
    configManager: config.ConfigManager,
    fileWatcher: watcher.FileWatcher)
{
    if (vscode.workspace.workspaceFolders != undefined) {
        vscode.workspace.workspaceFolders.forEach((folder) => {
            handleNewWorkspaceFolder(folder.uri.fsPath, rockContext,
                workspaces, configManager, fileWatcher);
        });
    }
}

function setupEvents(rockContext: context.Context, extensionContext: vscode.ExtensionContext,
    workspaces: autoproj.Workspaces, taskProvider: tasks.AutoprojProvider,
    configManager: config.ConfigManager, fileWatcher: watcher.FileWatcher)
{
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach((folder) => {
                handleNewWorkspaceFolder(folder.uri.fsPath, rockContext,
                    workspaces, configManager, fileWatcher);
            });
            event.removed.forEach((folder) => {
                let deletedWs = workspaces.deleteFolder(folder.uri.fsPath);
                if (deletedWs) {
                    unwatchManifest(deletedWs, fileWatcher);
                    deletedWs.readWatchPID().
                        then((pid) => process.kill(pid, 'SIGINT')).
                        catch(() => {})
                }
            });
            taskProvider.reloadTasks();
        })
    );
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(extensionContext: vscode.ExtensionContext) {
    let fileWatcher = new watcher.FileWatcher();
    let vscodeWrapper = new wrappers.VSCode(extensionContext);

    let outputChannel = vscode.window.createOutputChannel('Rock');
    let workspaces = new autoproj.Workspaces(null, outputChannel);
    let autoprojTaskProvider = new tasks.AutoprojProvider(workspaces);
    let rockContext = new context.Context(vscodeWrapper, workspaces,
        new packages.PackageFactory(vscodeWrapper),
        outputChannel);

    let configManager = new config.ConfigManager(workspaces, vscodeWrapper);
    let rockCommands = new commands.Commands(rockContext, vscodeWrapper, configManager);

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', autoprojTaskProvider));

    initializeWorkspacesFromVSCodeFolders(rockContext, workspaces,
        configManager, fileWatcher);
    autoprojTaskProvider.reloadTasks();
    setupEvents(rockContext, extensionContext, workspaces,
        autoprojTaskProvider, configManager, fileWatcher);
    rockCommands.register();

    extensionContext.subscriptions.push(workspaces);
    extensionContext.subscriptions.push(outputChannel);

    let cppDebugProvider = new debug.CXXConfigurationProvider(rockContext);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', cppDebugProvider));
    let rubyDebugProvider = new debug.RubyConfigurationProvider(rockContext);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('Ruby', rubyDebugProvider));
    let orogenDebugProvider = new debug.OrogenConfigurationProvider(rockContext, vscodeWrapper);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('orogen', orogenDebugProvider));

    extensionContext.subscriptions.push(rockContext);
    extensionContext.subscriptions.push(fileWatcher);
    const launchJsonDocumentSelector: vscode.DocumentSelector = [{
        language: 'jsonc',
        pattern: '**/launch.json'
    }];
    extensionContext.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        launchJsonDocumentSelector, new snippets.LaunchSnippetProvider(rockContext, vscodeWrapper)));
}

// this method is called when your extension is deactivated
export function deactivate() {
}
