import * as autoproj from './autoproj';
import * as context from './context';
import * as path from 'path';
import * as fs from 'fs'

export const C_CPP_PROPERTIES_JSON = `{
    "configurations": [
        {
            "name": "Mac",
            "includePath": [
                "/usr/include",
                "/usr/local/include",
                "\${workspaceRoot}"
            ],
            "defines": [],
            "intelliSenseMode": "clang-x64",
            "browse": {
                "path": [
                    "/usr/include",
                    "/usr/local/include",
                    "\${workspaceRoot}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            },
            "macFrameworkPath": [
                "/System/Library/Frameworks",
                "/Library/Frameworks"
            ],
            "compileCommands": "@DBPATH@"
        },
        {
            "name": "Linux",
            "includePath": [
                "/usr/local/include",
                "/usr/include",
                "\${workspaceRoot}"
            ],
            "defines": [],
            "intelliSenseMode": "clang-x64",
            "browse": {
                "path": [
                    "/usr/local/include",
                    "/usr/include",
                    "\${workspaceRoot}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            },
            "compileCommands": "@DBPATH@"
        },
        {
            "name": "Win32",
            "includePath": [
                "C:/Program Files (x86)/Microsoft Visual Studio 14.0/VC/include",
                "\${workspaceRoot}"
            ],
            "defines": [
                "_DEBUG",
                "UNICODE"
            ],
            "intelliSenseMode": "msvc-x64",
            "browse": {
                "path": [
                    "C:/Program Files (x86)/Microsoft Visual Studio 14.0/VC/include/*",
                    "\${workspaceRoot}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            },
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