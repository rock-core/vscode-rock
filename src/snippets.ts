import * as vscode from 'vscode';
import * as wrappers from './wrappers';
import { parse } from 'jsonc-parser';
import { basename, relative } from 'path';
import * as context from './context';
import * as packages from './packages';
import * as syskit from './syskit';

export class LaunchSnippetProvider implements vscode.CompletionItemProvider
{
    private readonly _vscode: wrappers.VSCode;
    private readonly _context: context.Context;
    constructor(context: context.Context, wrapper: wrappers.VSCode)
    {
        this._vscode = wrapper;
        this._context = context;
        wrapper.registerAndSubscribeCommand('rock.insertRelativeFilePath', async (path: string) => {
            const targetUri = await this._context.pickFile(path);
            if (targetUri) {
                this.replaceEditorSelection(this._vscode.activeTextEditor,
                    relative(path, targetUri[0].fsPath));
            }
        });
        wrapper.registerAndSubscribeCommand('rock.insertRelativeExecutablePath', async (path: string) => {
            let executablePath: string | undefined;
            try {
                executablePath = await this._context.pickExecutable(path);
                if (executablePath) {
                    this.replaceEditorSelection(this._vscode.activeTextEditor,
                        relative(path, executablePath));
                }
            }
            catch (err) {
                this._vscode.showWarningMessage(err.message);
            }
        });
        wrapper.registerAndSubscribeCommand('rock.insertTaskName', async (path: string) => {
            let pkg = await this._context.getPackageByPath(path) as packages.RockPackage;
            let deployment: syskit.AvailableDeployment | undefined;
            try {
                deployment = await this._context.pickTask(pkg.workspace);
                if (deployment) {
                    let deploy = deployment.default_deployment_for ?
                        deployment.default_deployment_for : deployment.name;
                    this.replaceEditorSelection(this._vscode.activeTextEditor, deploy);
                }
            }
            catch (err) {
                this._vscode.showWarningMessage(err.message);
            }
        });
    }

    replaceEditorSelection(editor: vscode.TextEditor | undefined, text: string) {
        if (editor) {
            const selections = editor!.selections;
            editor.edit((editBuilder) => {
                selections.forEach((selection) => {
                    editBuilder.replace(selection, '');
                    editBuilder.insert(selection.active, text);
                });
            });
        }
    }

    private async rubyItemForPackage(pkgPath: string): Promise<vscode.CompletionItem | undefined>
    {
        const launcher = this.snippetForPackageType(pkgPath,
            packages.Type.fromType(packages.TypeList.RUBY));
        let entry = JSON.stringify(launcher, null, 4);
        entry = entry.replace(/{{file}}/g, "\${1}");
        entry = entry.replace(/{{root}}/g, "\\$\{workspaceRoot}");

        const snippet = new vscode.SnippetString(entry);
        const item = new vscode.CompletionItem('Rock: Ruby',
            vscode.CompletionItemKind.Module);

        const pkg = await this._context.getPackageByPath(pkgPath);
        if (pkg instanceof packages.RockPackage) {
            item.insertText = snippet;
            item.command = {
                title: "rock.insertRelativeFilePath",
                command: "rock.insertRelativeFilePath",
                arguments: [pkgPath]
            }
            return item;
        }
    }

    private async cppItemForPackage(pkgPath: string): Promise<vscode.CompletionItem | undefined>
    {
        const launcher = this.snippetForPackageType(pkgPath,
            packages.Type.fromType(packages.TypeList.CXX));
        let entry = JSON.stringify(launcher, null, 4);
        entry = entry.replace(/{{file}}/g, "\${1}");
        entry = entry.replace(/{{root}}/g, "\\$\{rock:buildDir}");
        entry = entry.replace(/{{cwd}}/g, "\\$\{rock:buildDir}");

        const snippet = new vscode.SnippetString(entry);
        const item = new vscode.CompletionItem('Rock: C/C++',
            vscode.CompletionItemKind.Module);

        item.insertText = snippet;
        let args: string[] = [];
        const pkg = await this._context.getPackageByPath(pkgPath);
        if (pkg instanceof packages.RockPackage) {
            args = [pkg.info.builddir];
            item.command = {
                title: "rock.insertRelativeExecutablePath",
                command: "rock.insertRelativeExecutablePath",
                arguments: args
            }
            return item;
        }
    }

    private async orogenItemForPackage(pkgPath: string): Promise<vscode.CompletionItem | undefined>
    {
        const project = basename(pkgPath);
        const launcher = this.snippetForPackageType(pkgPath,
            packages.Type.fromType(packages.TypeList.OROGEN));
        let entry = JSON.stringify(launcher, null, 4);
        entry = entry.replace(/{{deploy}}/g, "\${1}");

        const snippet = new vscode.SnippetString(entry);
        const item = new vscode.CompletionItem('Rock: Orogen',
            vscode.CompletionItemKind.Module);

        item.insertText = snippet;
        let args: string[] = [];
        const pkg = await this._context.getPackageByPath(pkgPath);
        if (pkg instanceof packages.RockPackage) {
            args = [pkgPath];
            item.command = {
                title: "rock.insertTaskName",
                command: "rock.insertTaskName",
                arguments: args
            }
            return item;
        }
    }

    private async snippetsForPackage(pkgPath: string)
    {
        const items = [this.cppItemForPackage(pkgPath),
                       this.rubyItemForPackage(pkgPath),
                       this.orogenItemForPackage(pkgPath)];

        return Promise.all(items).then(result => {
            return result.filter(item => item != undefined) as vscode.CompletionItem[];
        });
    }

    private snippetForPackageType(pkgPath: string, type: packages.Type): vscode.DebugConfiguration | undefined
    {
        let config: vscode.DebugConfiguration | undefined;
        switch (type.id) {
            case packages.TypeList.OROGEN.id:
                config = {
                    type: "orogen",
                    request: "launch",
                    name: `orogen - {{deploy}}`,
                    deploy: "{{deploy}}",
                    deployAs: basename(pkgPath)
                }
                break;
            case packages.TypeList.CXX.id:
                config = {
                    type: "cppdbg",
                    request: "launch",
                    name: "{{file}}",
                    program: "{{root}}/{{file}}",
                    cwd: "{{cwd}}",
                    MIMode: "gdb",
                    setupCommands: [
                        {
                            description: "Enable pretty-printing for gdb",
                            text: "-enable-pretty-printing",
                            ignoreFailures: false
                        }
                    ]
                }
                break;
            case packages.TypeList.RUBY.id:
                config = {
                    type: "Ruby",
                    request: "launch",
                    name: "{{file}}",
                    program: "{{root}}/{{file}}",
                }
                break;
        }
        return config;
    }

    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionList | vscode.CompletionItem[]>
    {
        const pkgPath = this._vscode.getWorkspaceFolder(document.fileName);
        if (!pkgPath) return [];

        let items: vscode.CompletionItem[] = await this.snippetsForPackage(pkgPath.uri.fsPath);
        const launch: any = parse(document.getText());

        if (launch.configurations && launch.configurations.length !== 0) {
            items.map((item) => {
                (item.insertText as vscode.SnippetString).appendText(",");
            });
        }
        return items;
    }
}