import * as vscode from 'vscode';
import { basename, relative } from 'path';
import * as autoproj from './autoproj';
import * as context from './context';
import * as tasks from './tasks';
import * as debug from './debug';

function assert_workspace_not_empty(workspaces: autoproj.Workspaces)
{
    if (workspaces.folderToWorkspace.size == 0)
        throw new Error("Current workspace is empty");
}

export async function choosePackage(context: context.Context) {
    assert_workspace_not_empty(context.workspaces);
    let choices = new Array<{ label: string,
                              description: string,
                              root: string,
                              name: string }>();

    context.workspaces.forEachFolder((ws, folder) => {
        choices.push({ label: relative(ws.root, folder),
                       description: ws.name,
                       root: folder,
                       name: basename(folder) });
    });

    const chosen = await context.vscode.showQuickPick(choices);
    if (chosen) {
        context.selectedPackage = { name: chosen.name, root: chosen.root };
    }
    return chosen;
}

export function buildSelectedPackage(context: context.Context,
    taskProvider: tasks.Provider)
{
    assert_workspace_not_empty(context.workspaces);
    if (!context.selectedPackage)
        throw new Error("Selected package is invalid")
    let task = taskProvider.buildTask(context.selectedPackage.root);
    if (!task)
        throw new Error("Selected package does not have a build task");

    context.vscode.executeCommand("workbench.action.tasks.runTask",
        task.source + ": " + task.name);
}

export async function choosePackageType(rockContext: context.Context) {
    assert_workspace_not_empty(rockContext.workspaces);
    if (!rockContext.selectedPackage)
        throw new Error("Current selected package is invalid");

    let choices = new Array<{ label: string,
                              description: string,
                              type: context.PackageType }>();

    context.PackageTypeList.allTypes.forEach((type) => {
        choices.push({ label: type.label,
                       description: '',
                       type: type});
    });

    const chosen = await rockContext.vscode.showQuickPick(choices);
    if (chosen) {
        rockContext.selectedPackageType = chosen.type;
    }
    return chosen;
}

export async function selectDebuggingTarget(rockContext: context.Context,
    factory: debug.TargetPickerFactory)
{
    assert_workspace_not_empty(rockContext.workspaces);
    if (!rockContext.selectedPackage)
        throw new Error("Current selected package is invalid");

    let packageType = rockContext.selectedPackageType;
    let packageRoot = rockContext.selectedPackage.root
    const picker = factory.createPicker(packageType, packageRoot);
    if (!picker)
        throw new Error('Debugging is not available for this package');

    const target = await picker.show();
    if (target)
        rockContext.debuggingTarget = target;

    return target;
}

export async function debugSelectedPackage(rockContext: context.Context,
    provider: debug.ConfigurationProvider)
{
    assert_workspace_not_empty(rockContext.workspaces);
    if (!rockContext.selectedPackage)
        throw new Error("Current selected package is invalid");
    if (!rockContext.debuggingTarget)
        throw new Error("Debugging target is unset");

    const target = rockContext.debuggingTarget;
    const type = rockContext.selectedPackageType;
    const cwd = rockContext.selectedPackage.root;

    const options = await provider.configuration(target, type, cwd);
    if (!options)
        throw new Error('Debugging is not available for this package');

    const uri = vscode.Uri.file(rockContext.selectedPackage.root);
    const folder = rockContext.vscode.getWorkspaceFolder(uri);
    rockContext.vscode.startDebugging(folder, options);
}
