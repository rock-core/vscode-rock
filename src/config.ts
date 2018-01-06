import * as autoproj from './autoproj';
import * as context from './context';
import * as path from 'path';
import * as fs from 'fs';
import * as parser from 'jsonc-parser';

export class ConfigManager
{
    private readonly _workspaces: autoproj.Workspaces;
    constructor(workspaces: autoproj.Workspaces)
    {
        this._workspaces = workspaces;
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

        const pkgName = path.relative(ws.root, pkgPath)
        let pkgModel = wsInfo.packages.get(pkgName);
        if (!pkgModel)
            return false;

        if (pkgModel.type != "Autobuild::CMake" && pkgModel.type != "Autobuild::Orogen")
            return false;

        return this.writeCppProperties(pkgPath, pkgModel);
    }
    private writeCppProperties(pkgPath: string, pkgModel: autoproj.Package): boolean
    {
        const dbPath = path.join(pkgModel.builddir, "compile_commands.json");
        const options = {
            mode: 0o644,
            flag: 'w'
        };
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
            fs.writeFileSync(this.cppPropertiesPath(pkgPath), JSON.stringify(data, null, 4), options);
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
    private loadCppProperties(pkgPath: string)
    {
        let errors: parser.ParseError[] = [];
        let stringData = fs.readFileSync(this.cppPropertiesPath(pkgPath), "utf8");
        let data = parser.parse(stringData, errors)

        if (errors.length > 0)
            throw new Error("Could not load c_cpp_properties.json");

        return data;
    }
    private updateCppProperties(pkgPath: string, pkgModel: autoproj.Package)
    {
        const dbPath = path.join(pkgModel.builddir, "compile_commands.json");
        const data = this.loadCppProperties(pkgPath);
        const options = {
            mode: 0o644,
            flag: 'w'
        };

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
        fs.writeFileSync(this.cppPropertiesPath(pkgPath), JSON.stringify(data, null, 4), options);
    }
}
