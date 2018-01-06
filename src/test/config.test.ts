import * as config from '../config';
import * as helpers from './helpers';
import * as fs from 'fs';
import * as TypeMoq from 'typemoq';
import * as autoproj from '../autoproj';
import * as assert from 'assert';
import { join, basename, dirname } from 'path';

describe("ConfigManager", function () {
    describe("setupPackage", function () {
        let pkgPath: string;
        let subject: config.ConfigManager;
        let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
        beforeEach(function () {
            pkgPath = helpers.init();
            mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
            subject = new config.ConfigManager(mockWorkspaces.object);
        })
        afterEach(function () {
            try
            {
                fs.rmdirSync(join(pkgPath, '.vscode'));
            }
            catch {}
            helpers.clear();
        })
        describe("writeCppProperties", function () {
            let folderToWorkspaces: Map<string, autoproj.Workspace>;
            let mockWs: TypeMoq.IMock<autoproj.Workspace>;
            let wsInfo: autoproj.WorkspaceInfo;
            let propertiesPath: string;
            beforeEach(function () {
                folderToWorkspaces = new Map<string, autoproj.Workspace>();
                mockWs = TypeMoq.Mock.ofType<autoproj.Workspace>();
                mockWs.setup(x => x.root).returns(() => dirname(pkgPath));
                mockWorkspaces.setup(x => x.folderToWorkspace).returns(() => folderToWorkspaces);
                wsInfo = new autoproj.WorkspaceInfo(dirname(pkgPath));
                wsInfo.packages = new Map<string, autoproj.Package>();
                propertiesPath = join(pkgPath, ".vscode", "c_cpp_properties.json");
            })
            afterEach(function () {
                try
                {
                    fs.unlinkSync(propertiesPath);
                }
                catch {}
            })
            it("does nothing if the package is not in an autoproj workspace", async function () {
                assert.equal(await subject.setupPackage(pkgPath), false);
                assert.equal(fs.existsSync(propertiesPath), false);
            })
            it("does nothing if the installation manifest could not be loaded", async function () {
                mockWs.setup(x => x.info()).returns(() => Promise.reject(new Error("test")));
                folderToWorkspaces.set(pkgPath, mockWs.object);
                assert.equal(await subject.setupPackage(pkgPath), false);
                assert.equal(fs.existsSync(propertiesPath), false);
            })
            it("does nothing if the package is not registered", async function () {
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                folderToWorkspaces.set(pkgPath, mockWs.object);
                assert.equal(await subject.setupPackage(pkgPath), false);
                assert.equal(fs.existsSync(propertiesPath), false);
            })
            function createPackageModel(pkgType: string)
            {
                let pkgModel: autoproj.Package = {
                    name: basename(pkgPath),
                    type: pkgType,
                    vcs: { type: "", url: "", repository_id: "" },
                    srcdir: pkgPath,
                    builddir: join(pkgPath, "build"),
                    logdir: "",
                    prefix: "",
                    dependencies: []
                }
                return pkgModel;
            }
            it("does nothing if the package is not a cmake package", async function () {
                wsInfo.packages.set(basename(pkgPath), createPackageModel("Autobuild::Ruby"));
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                folderToWorkspaces.set(pkgPath, mockWs.object);
                assert.equal(await subject.setupPackage(pkgPath), false);
                assert.equal(fs.existsSync(propertiesPath), false);
            })
            it("does nothing if config file already exists", async function () {
                wsInfo.packages.set(basename(pkgPath), createPackageModel("Autobuild::CMake"));
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                folderToWorkspaces.set(pkgPath, mockWs.object);
                fs.mkdirSync(join(pkgPath, ".vscode"));
                fs.writeFileSync(propertiesPath, "dummyfile");
                assert.equal(await subject.setupPackage(pkgPath), false);
                assert.equal(fs.readFileSync(propertiesPath, "utf8"), "dummyfile");
            })
            async function testType(type: string)
            {
                wsInfo.packages.set(basename(pkgPath), createPackageModel(type));
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                folderToWorkspaces.set(pkgPath, mockWs.object);
                assert.equal(await subject.setupPackage(pkgPath), true);

                let dbPath = join(pkgPath, "build", "compile_commands.json");
                let expectedData = config.C_CPP_PROPERTIES_JSON.replace(/@DBPATH@/g, dbPath);
                let actualData = fs.readFileSync(propertiesPath, "utf8");
                assert.equal(actualData, expectedData);
            }
            it("writes the config file if package type is cmake", async function () {
                await testType("Autobuild::CMake");
            })
            it("writes the config file if package type is orogen", async function () {
                await testType("Autobuild::Orogen");
            })
        })
    })
})