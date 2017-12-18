import * as vscode from 'vscode';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as context from './context';
import * as tasks from './tasks';
import * as debug from './debug';
import * as status from './status';

function assert_workspace_not_empty(context: context.Context)
{
    if (!context.vscode.workspaceFolders || context.vscode.workspaceFolders.length == 0)
        throw new Error("Current workspace is empty");
}

export class Commands
{
    readonly context: context.Context;
    readonly taskProvider: tasks.Provider;
    readonly pickerFactory: debug.TargetPickerFactory;
    readonly debugProvider: debug.ConfigurationProvider;
    readonly statusBar: status.StatusBar;

    constructor(context: context.Context, taskProvider: tasks.Provider,
        pickerFactory: debug.TargetPickerFactory,
        debugProvider: debug.ConfigurationProvider, statusBar: status.StatusBar)
    {
        this.context = context;
        this.taskProvider = taskProvider;
        this.pickerFactory = pickerFactory;
        this.debugProvider = debugProvider;
        this.statusBar = statusBar;
    }

    async selectPackage()
    {
        assert_workspace_not_empty(this.context);
        let choices = new Array<{ label: string,
                                  description: string,
                                  root: string,
                                  name: string }>();

        this.context.workspaces.forEachFolder((ws, folder) => {
            choices.push({ label: relative(ws.root, folder),
                           description: ws.name,
                           root: folder,
                           name: basename(folder) });
        });

        const chosen = await this.context.vscode.showQuickPick(choices);
        if (chosen) {
            this.context.selectedPackage = { name: chosen.name, root: chosen.root };
            this.statusBar.update();
        }
    }

    buildPackage()
    {
        if (!this.context.selectedPackage)
            throw new Error("Selected package is invalid")
        let task = this.taskProvider.buildTask(this.context.selectedPackage.root);
        if (!task)
            throw new Error("Selected package does not have a build task");

        this.context.vscode.executeCommand("workbench.action.tasks.runTask",
            task.source + ": " + task.name);
    }

    async selectPackageType()
    {
        if (!this.context.selectedPackage)
            throw new Error("Selected package is invalid");

        let choices = new Array<{ label: string,
                                  description: string,
                                  type: context.PackageType }>();

        context.PackageTypeList.allTypes.forEach((type) => {
            choices.push({ label: type.label,
                           description: '',
                           type: type});
        });

        const chosen = await this.context.vscode.showQuickPick(choices);
        if (chosen) {
            this.context.selectedPackageType = chosen.type;
            this.statusBar.update();
        }
    }

    async setDebuggingTarget()
    {
        if (!this.context.selectedPackage)
            throw new Error("Selected package is invalid");

        if (!this.context.workspaces.folderToWorkspace.has(this.context.selectedPackage.root))
            throw new Error("Selected package is not part of an autoproj workspace");

        let packageType = this.context.selectedPackageType;
        let packageRoot = this.context.selectedPackage.root
        const picker = this.pickerFactory.createPicker(packageType, packageRoot);
        if (!picker)
            throw new Error('Debugging is not available for this package');

        const target = await picker.show();
        if (target)
        {
            this.context.debuggingTarget = target;
            this.statusBar.update();
        }
    }

    async debugPackage()
    {
        if (!this.context.selectedPackage)
            throw new Error("Selected package is invalid");

        if (!this.context.workspaces.folderToWorkspace.has(this.context.selectedPackage.root))
            throw new Error("Selected package is not part of an autoproj workspace");

        if (!this.context.debuggingTarget)
            throw new Error("Debugging target is unset");

        const target = this.context.debuggingTarget;
        const type = this.context.selectedPackageType;
        const cwd = this.context.selectedPackage.root;

        const options = await this.debugProvider.configuration(target, type, cwd);
        if (!options)
            throw new Error('Debugging is not available for this package');

        const uri = vscode.Uri.file(this.context.selectedPackage.root);
        const folder = this.context.vscode.getWorkspaceFolder(uri);
        this.context.vscode.startDebugging(folder, options);
    }

    register()
    {
        function register(receiver, name) {
            let fn = receiver[name].bind(receiver);
            return vscode.commands.registerCommand('rock.' + name, _ => fn());
        }

        for (const key of ['selectPackage',
                           'buildPackage',
                           'selectPackageType',
                           'setDebuggingTarget',
                           'debugPackage'])
        {
            this.context.extensionContext.subscriptions.
                push(register(this, key));
        }
    }
}