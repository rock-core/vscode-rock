import * as autoproj from './autoproj';
import * as context from './context';
import * as path from 'path';
import * as fs from 'fs'

export const C_CPP_PROPERTIES_JSON = `{
    "configurations": [
        {
            "name": "Mac",
            "compileCommands": "@DBPATH@"
        },
        {
            "name": "Linux",
            "compileCommands": "@DBPATH@"
        },
        {
            "name": "Win32",
            "compileCommands": "@DBPATH@"
        }
    ],
    "version": 3
}`

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
        const fileData = C_CPP_PROPERTIES_JSON.replace(/@DBPATH@/g, dbPath);
        const propertiesPath = path.join(pkgPath, ".vscode", "c_cpp_properties.json");
        const options = {
            mode: 0o644,
            flag: 'w'
        };
        if (fs.existsSync(propertiesPath))
            return false;

        this.createVscodeFolder(pkgPath);
        fs.writeFileSync(propertiesPath, fileData, options);
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
}