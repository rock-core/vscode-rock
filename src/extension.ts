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
import * as snippets from './snippets';
import * as watcher from './watcher';
import { Manager as VSCodeWorkspaceManager } from './vscode_workspace_manager';

function applyConfiguration(configManager : config.ConfigManager,
    workspaces : autoproj.Workspaces) : void {
    workspaces.devFolder = configManager.getDevFolder();
    configManager.autoApplySettings();
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
    let vscodeWorkspaceManager = new VSCodeWorkspaceManager(
        rockContext, workspaces, autoprojTaskProvider, configManager, fileWatcher);
    let rockCommands = new commands.Commands(rockContext, vscodeWrapper, configManager);

    applyConfiguration(configManager, workspaces);
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(
            () => applyConfiguration(configManager, workspaces)))
    extensionContext.subscriptions.push(
        vscode.tasks.onDidStartTaskProcess((event) => {
            workspaces.notifyStartTaskProcess(event)
        })
    )

    extensionContext.subscriptions.push(
        vscode.workspace.registerTaskProvider('autoproj', autoprojTaskProvider));

    vscodeWorkspaceManager.initializeWorkspaces(vscodeWrapper.workspaceFolders);
    autoprojTaskProvider.reloadTasks();
    extensionContext.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            vscodeWorkspaceManager.handleWorkspaceChangeEvent(event)
        })
    )

    rockCommands.register();

    extensionContext.subscriptions.push(workspaces);
    extensionContext.subscriptions.push(outputChannel);

    let cppDebugProvider = new debug.CXXConfigurationProvider(rockContext, configManager);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', cppDebugProvider));
    let rubyDebugProvider = new debug.RubyConfigurationProvider(rockContext, configManager);
    extensionContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('Ruby', rubyDebugProvider));
    let orogenDebugProvider = new debug.OrogenConfigurationProvider(rockContext, vscodeWrapper, configManager);
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
