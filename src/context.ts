import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { basename, relative, dirname } from 'path';
import * as autoproj from './autoproj';
import * as debug from './debug';
import * as tasks from './tasks';
import * as packages from './packages';
import * as fs from 'fs';
import { join as joinPath } from 'path';
import * as syskit from './syskit';

export class Context
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _packageFactory: packages.PackageFactory;
    private readonly _contextUpdatedEvent: vscode.EventEmitter<void>;
    private readonly _outputChannel: vscode.OutputChannel;
    private _pendingWorkspaceInit = new Map<autoproj.Workspace, Promise<void>>();
    private _verifiedSyskitContext = new Map<autoproj.Workspace, boolean>();

    public constructor(vscodeWrapper: wrappers.VSCode,
                       workspaces: autoproj.Workspaces,
                       packageFactory : packages.PackageFactory,
                       outputChannel : vscode.OutputChannel)
    {
        this._vscode = vscodeWrapper;
        this._workspaces = workspaces;
        this._contextUpdatedEvent = new vscode.EventEmitter<void>();
        this._packageFactory = packageFactory;
        this._outputChannel = outputChannel;
    }

    get outputChannel(): vscode.OutputChannel
    {
        return this._outputChannel;
    }

    public dispose() {
        this._contextUpdatedEvent.dispose();
    }

    public onUpdate(callback)
    {
        return this._contextUpdatedEvent.event(callback);
    }

    public isWorkspaceEmpty() : boolean {
        let folders = this._vscode.workspaceFolders;
        return (!folders || folders.length == 0);
    }

    public getWorkspaceByPath(path : string) : autoproj.Workspace | undefined
    {
        return this.workspaces.folderToWorkspace.get(path);
    }

    public getPackageByPath(path : string) : Promise<packages.Package>
    {
        return this._packageFactory.createPackage(path, this);
    }

    public get workspaces(): autoproj.Workspaces
    {
        return this._workspaces;
    }

    public async updateWorkspaceInfo(ws: autoproj.Workspace) {
        await ws.envsh();
        this._contextUpdatedEvent.fire();
    }

    public async pickFile(defaultUri: string) {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(defaultUri),
            openLabel: "Debug file"
        };
        return await this._vscode.showOpenDialog(options);
    }

    async listExecutables(path: string): Promise<string[]> {
        let executables: string[] = [];
        const EXCLUDED_DIRS = [/^\./,
                               /^CMakeFiles$/];

        const EXCLUDED_FILES = [/^libtool$/,
                                /^config.status$/,
                                /^configure$/,
                                /(\.so\.)+(\d+\.)?(\d+\.)?(\d+)$/,
                                /\.so$/,
                                /\.sh$/,
                                /\.rb$/,
                                /\.py$/];

        if (!fs.existsSync(path))
            throw new Error("Build directory does not exist. Did you build the package first?");

        const files = fs.readdirSync(path);
        for (let file of files) {
            const fullPath = joinPath(path, file);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(fullPath);
            }
            catch (e) {
                continue; // ignore files that can't be stat'ed (i.e broken symlinks)
            }
            if (stat.isDirectory()) {
                if (!EXCLUDED_DIRS.some(filter => filter.test(file))) {
                    executables = executables.concat(await this.listExecutables(fullPath));
                }
            } else if (stat.isFile()) {
                if (!EXCLUDED_FILES.some(filter => filter.test(file))) {
                    if (stat.mode & fs.constants.S_IXUSR) {
                        executables.push(fullPath);
                    }
                }
            }
        }
        return executables;
    }
    private async executablePickerChoices(path: string): Promise<{ label: string, description: string, path: string }[]>
    {
        let choices: { label: string, description: string, path: string }[] = [];
        for (let choice of await this.listExecutables(path)) {
            choices.push({
                label: basename(choice),
                description: relative(path, dirname(choice)),
                path: choice
            });
        }
        return choices;
    }
    async pickExecutable(path: string): Promise<string | undefined>
    {
        const tokenSource = new vscode.CancellationTokenSource();
        const choices = this.executablePickerChoices(path);
        let err;
        choices.catch((_err) => {
            err = _err;
            tokenSource.cancel();
        })

        const options: vscode.QuickPickOptions = {
            placeHolder: "Select an executable target to debug"
        }
        const selected = await this._vscode.showQuickPick(choices, options, tokenSource.token);
        tokenSource.dispose();

        if (selected) {
            return selected.path;
        } else if (err) {
            throw err;
        }
    }

    private async taskPickerChoices(workspace: autoproj.Workspace)
    {
        let syskitConnection = await workspace.syskitDefaultConnection();
        let deployments = await syskitConnection.availableDeployments();

        let choices: any[] = [];
        deployments.forEach((deployment) => {
            if (deployment.default_deployment_for) {
                choices.push({
                    label: deployment.default_deployment_for,
                    description: '',
                    orogen_info: deployment
                });
            }
            else {
                choices.push({
                    label: deployment.name,
                    description: '',
                    orogen_info: deployment
                });
            }
        });
        return choices;
    }
    async pickTask(workspace: autoproj.Workspace): Promise<syskit.AvailableDeployment | undefined>
    {
        let err = null;
        let choices = this.taskPickerChoices(workspace);
        let tokenSource = new vscode.CancellationTokenSource();
        choices.catch((e) => err = e);

        let task = await this._vscode.showQuickPick(choices,
            { placeHolder: 'Select a task or deployment model' },
            tokenSource.token);
        tokenSource.dispose();
        // Note: we know the promise is resolved at this point thanks to the
        // await on the target picker
        if (err) {
            throw err;
        }
        else if (task)
        {
            return task.orogen_info;
        }
    }
}
