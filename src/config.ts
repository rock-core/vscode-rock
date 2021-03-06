import * as autoproj from './autoproj';
import * as context from './context';
import * as path from 'path';
import * as fs from 'fs';
import * as parser from 'jsonc-parser';
import * as vscode from 'vscode';
import { basename } from 'path';
import * as wrappers from './wrappers';

export class ConfigManager
{
    private readonly _defaultWriteOptions;
    private readonly _workspaces: autoproj.Workspaces;
    private readonly _vscode: wrappers.VSCode;
    constructor(workspaces: autoproj.Workspaces, wrapper: wrappers.VSCode)
    {
        this._defaultWriteOptions = {
            mode: 0o644,
            flag: 'w'
        };
        this._workspaces = workspaces;
        this._vscode = wrapper;
    }
    async setupPackage(pkgPath: string): Promise<boolean>
    {
        let ws = this._workspaces.folderToWorkspace.get(pkgPath);
        if (!ws)
            return false;

        let wsInfo: autoproj.WorkspaceInfo;
        try {
            wsInfo = await ws.info();
        }
        catch {
            return false;
        }

        let pkgModel = wsInfo.packages.get(pkgPath);
        if (!pkgModel)
            return false;

        if (pkgModel.type != "Autobuild::CMake" && pkgModel.type != "Autobuild::Orogen")
            return false;

        return this.writeCppProperties(pkgPath, pkgModel);
    }

    public getDevFolder() : string | null {
        return this._vscode.getConfiguration().get<string|null>('rock.devFolder', null);
    }

    private writeCppProperties(pkgPath: string, pkgModel: autoproj.Package): boolean
    {
        const dbPath = path.join(pkgModel.builddir, "compile_commands.json");
        if (fs.existsSync(this.cppPropertiesPath(pkgPath))) {
            this.updateCppProperties(pkgPath, pkgModel);
        } else {
            let data = {
                configurations: [
                    {name: "Mac", compileCommands: dbPath},
                    {name: "Linux", compileCommands: dbPath},
                    {name: "Win32", compileCommands: dbPath}
                ],
                version: 3
            }
            this.createVscodeFolder(pkgPath);
            fs.writeFileSync(this.cppPropertiesPath(pkgPath),
                JSON.stringify(data, null, 4), this._defaultWriteOptions);
        }
        return true;
    }
    private createVscodeFolder(pkgPath: string): boolean
    {
        let folder = path.join(pkgPath, ".vscode");
        if (fs.existsSync(folder))
            return false;

        fs.mkdirSync(folder, 0o755);
        return true;
    }
    private cppPropertiesPath(pkgPath: string)
    {
        return path.join(pkgPath, ".vscode", "c_cpp_properties.json");
    }
    private updateCppProperties(pkgPath: string, pkgModel: autoproj.Package): void
    {
        const dbPath = path.join(pkgModel.builddir, "compile_commands.json");
        const data = this.loadJsonFile(this.cppPropertiesPath(pkgPath));

        if (!data.configurations) data.configurations = [];
        if (!Array.isArray(data.configurations))
            throw new Error("Invalid configuration in c_cpp_properties.json");

        ["Mac", "Linux", "Win32"].forEach(element => {
            let foundObject: any = data.configurations.find(obj => obj.name === element);
            if (foundObject) {
                foundObject.compileCommands = dbPath;
            }
            else {
                data.configurations.push({name: element, compileCommands: dbPath});
            }
        });
        if (!data.version) data.version = 3;
        fs.writeFileSync(this.cppPropertiesPath(pkgPath),
            JSON.stringify(data, null, 4), this._defaultWriteOptions);
    }
    private loadJsonFile(path: string)
    {
        let errors: parser.ParseError[] = [];
        let stringData = fs.readFileSync(path, "utf8");
        let data = parser.parse(stringData, errors)

        if (errors.length > 0)
            throw new Error(`Could not load ${basename(path)}`);

        return data;
    }
    private tasksConfigurationPath(pkgPath: string)
    {
        return path.join(pkgPath, ".vscode", "tasks.json");
    }
    private writeConfigFile(path, data)
    {
        fs.writeFileSync(path, JSON.stringify(data, null, 4), this._defaultWriteOptions);
    }
    private updateTasksConfig(path: string, config: vscode.TaskDefinition)
    {
        const data = this.loadJsonFile(path);

        if (!data.tasks)
            data.tasks = [];
        if (!Array.isArray(data.tasks))
            throw new Error("Invalid tasks in tasks.json");
        if (!data.version)
            data.version = "2.0.0";

        data.tasks = data.tasks.filter(t => t.name != config.name)
        (data.tasks as Array<any>).unshift(config);
        this.writeConfigFile(path, data);
    }
    private launchConfigurationPath(pkgPath: string)
    {
        return path.join(pkgPath, ".vscode", "launch.json");
    }
    private uniqueLaunchConfigName(candidate: string, currentConfigs: vscode.DebugConfiguration[]): string
    {
        let count = 2;
        while (currentConfigs.some(config => config.name == candidate)) {
            candidate = `${candidate} ${count}`;
        }
        return candidate;
    }
    private updateLaunchConfig(path: string, config: vscode.DebugConfiguration)
    {
        const data = this.loadJsonFile(path);

        if (!data.configurations)
            data.configurations = [];
        if (!Array.isArray(data.configurations))
            throw new Error("Invalid configuration in launch.json");
        if (!data.version)
            data.version = "0.2.0";

        config.name = this.uniqueLaunchConfigName(config.name, data.configurations);
        (data.configurations as Array<any>).unshift(config);
        this.writeConfigFile(path, data);
    }
    addLaunchConfig(pkgPath: string, config: vscode.DebugConfiguration)
    {
        const path = this.launchConfigurationPath(pkgPath);
        if (fs.existsSync(path)) {
            this.updateLaunchConfig(path, config);
        } else {
            this.createVscodeFolder(pkgPath);
            this.writeConfigFile(path, {
                version: "0.2.0",
                configurations: [config]
            });
        }
    }

    autoApplyRubySettings() : boolean {
        return this._vscode.getConfiguration().get("rock.applyRubySettings", true);
    }

    autoApplyCPPSettings() : boolean {
        return this._vscode.getConfiguration().get("rock.applyCPPSettings", true);
    }

    autoApplySettings() {
        if (this._workspaces.size !== 1) {
            return;
        }

        if (this.autoApplyRubySettings()) {
            this.applyRubySettings(vscode.ConfigurationTarget.Workspace);
        }
        if (this.autoApplyCPPSettings()) {
            this.applyCPPSettings(vscode.ConfigurationTarget.Workspace);
        }
    }

    suggestedEditorSettings(scope: vscode.ConfigurationTarget): any
    {
        return {
            "editor.detectIndentation": false,
            "editor.insertSpaces": true,
            "editor.rulers": [80, 90],
            "editor.tabSize": 4,
            "editor.trimAutoWhitespace": true,
            "files.trimTrailingWhitespace": true,
            "git.countBadge": "tracked"
        }
    }
    suggestedCPPSettings(scope: vscode.ConfigurationTarget): any
    {
        return {
            "C_Cpp.intelliSenseEngine": "Default",
            "C_Cpp.intelliSenseEngineFallback": "Enabled",
        }
    }
    suggestedRubySettings(scope: vscode.ConfigurationTarget): any
    {
        let settings = {}
        if (scope === vscode.ConfigurationTarget.Workspace) {
            // Apply the following settings only if we have a single Autoproj
            // workspace. We need to set the path to a single autoproj
            // executable
            let workspaces : autoproj.Workspace[] = []
            this._workspaces.forEachWorkspace((ws) => workspaces.push(ws))
            let ws = workspaces.find(() => true) as autoproj.Workspace;

            if (workspaces.length > 1) {
                this._vscode.showWarningMessage(
                    "Most Ruby settings can be automatically set "+
                    "only in workspaces with a single Autoproj workspace");

            }
            else if (workspaces.length === 0) {
                this._vscode.showWarningMessage(
                    "Most Ruby settings can be automatically set "+
                    "only in workspaces with a single Autoproj workspace");
            }
            else {
                settings['solargraph.bundlerPath'] = ws.autoprojExePath();
                settings['solargraph.useBundler'] = true;
                settings['ruby.intellisense'] = false;
                settings['ruby.codeCompletion'] = false;
                settings['ruby.pathToBundler'] = ws.autoprojExePath();
                settings['ruby.useBundler'] = true;
                settings['ruby.lint'] = { rubocop: true };
            }
        }
        return settings
    }

    applySuggestedSettings(settings, configTarget : vscode.ConfigurationTarget)
    {
        const configs = this._vscode.getConfiguration();
        for (const key in settings) {
            configs.update(key, settings[key], configTarget);
        }
    }

    currentWorkspace() : autoproj.Workspace | undefined {
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            let path = editor.document.uri.fsPath;
            return this._workspaces.getWorkspaceFromFolder(path);
        }
    }

    applyDefaultSettings(scope: vscode.ConfigurationTarget): any
    {
        this.applySuggestedSettings(this.suggestedEditorSettings(scope), scope);
        this.applySuggestedSettings(this.suggestedCPPSettings(scope), scope);
        this.applySuggestedSettings(this.suggestedRubySettings(scope), scope);
    }

    applyEditorSettings(scope: vscode.ConfigurationTarget): any
    {
        this.applySuggestedSettings(this.suggestedEditorSettings(scope), scope);
    }

    applyCPPSettings(scope: vscode.ConfigurationTarget): any
    {
        this.applySuggestedSettings(this.suggestedCPPSettings(scope), scope);
    }

    applyRubySettings(scope: vscode.ConfigurationTarget): any
    {
        this.applySuggestedSettings(this.suggestedRubySettings(scope), scope);
    }
}
