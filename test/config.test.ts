import * as config from '../src/config';
import * as helpers from './helpers';
import * as fs from 'fs';
import * as TypeMoq from 'typemoq';
import * as autoproj from '../src/autoproj';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { join, basename, dirname } from 'path';
import { assertThrowsAsync } from './helpers';
import * as wrappers from '../src/wrappers';

describe("ConfigManager", function () {
    let pkgPath: string;
    let mockWorkspaces: TypeMoq.IMock<autoproj.Workspaces>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let subject: config.ConfigManager;
    beforeEach(function () {
        pkgPath = helpers.init();
        mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new config.ConfigManager(mockWorkspaces.object,
            mockWrapper.object);
        helpers.registerDir('.vscode');
    })
    afterEach(function () {
        helpers.clear();
    })
    describe("setupPackage", function () {
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
                propertiesPath = join(pkgPath, ".vscode",  "c_cpp_properties.json");
                helpers.registerFile('.vscode', 'c_cpp_properties.json');
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
            function setMockPackageType(type: string)
            {
                wsInfo.packages.set(pkgPath, createPackageModel(type));
                mockWs.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));
                folderToWorkspaces.set(pkgPath, mockWs.object);
            }
            it("does nothing if the package is not a cmake/orogen package", async function () {
                setMockPackageType("Autobuild::Ruby");
                assert.equal(await subject.setupPackage(pkgPath), false);
                assert.equal(fs.existsSync(propertiesPath), false);
            })
            it("throws if existing file is invalid", async function () {
                setMockPackageType("Autobuild::CMake");
                fs.mkdirSync(join(pkgPath, ".vscode"));
                fs.writeFileSync(propertiesPath, "dummyfile");
                await assertThrowsAsync(subject.setupPackage(pkgPath),
                    /Could not load/);
                assert.equal(fs.readFileSync(propertiesPath, "utf8"), "dummyfile");
            })
            async function testType(type: string)
            {
                setMockPackageType(type);
                assert.equal(await subject.setupPackage(pkgPath), true);
                let dbPath = join(pkgPath, "build", "compile_commands.json");
                let data = {
                    configurations: [
                        {name: "Mac", compileCommands: dbPath},
                        {name: "Linux", compileCommands: dbPath},
                        {name: "Win32", compileCommands: dbPath}
                    ],
                    version: 3
                }
                let expectedData = JSON.stringify(data, null, 4);
                let actualData = fs.readFileSync(propertiesPath, "utf8");
                assert.equal(actualData, expectedData);
            }
            it("creates the config file if package type is cmake", async function () {
                await testType("Autobuild::CMake");
            })
            it("creates the config file if package type is orogen", async function () {
                await testType("Autobuild::Orogen");
            })
            it("updates an existing configuration", async function () {
                let currentConf = {
                    configurations: [
                        {
                            name: "Linux",
                            compileCommands: "/some/path/compile_commands.json",
                            arbitraryEntry: "something"
                        },
                        {
                            name: "Mac",
                            compileCommands: "/cmpdb.json",
                            arbitraryArray: [
                                "entry"
                            ]
                        }
                    ],
                    version: 2
                }
                setMockPackageType("Autobuild::CMake");
                fs.mkdirSync(join(pkgPath, ".vscode"));
                fs.writeFileSync(propertiesPath, JSON.stringify(currentConf));
                assert.equal(await subject.setupPackage(pkgPath), true);

                let updated = JSON.parse(fs.readFileSync(propertiesPath, "utf8"));
                let dbPath = join(pkgPath, "build", "compile_commands.json");
                assert.equal(updated.configurations[0].name, "Linux");
                assert.equal(updated.configurations[0].compileCommands, dbPath);
                assert.equal(updated.configurations[1].name, "Mac");
                assert.equal(updated.configurations[1].compileCommands, dbPath);
                assert.equal(updated.configurations[2].name, "Win32");
                assert.equal(updated.configurations[2].compileCommands, dbPath);
                assert.equal(updated.version, currentConf.version);

                let writtenArbitraryEntry = (currentConf as any).configurations[0].arbitraryEntry;
                let readArbitraryEntry = updated.configurations[0].arbitraryEntry;
                assert.equal(readArbitraryEntry, writtenArbitraryEntry);

                let writtenArbitraryArray = (currentConf as any).configurations[1].arbitraryArray;
                let readArbitraryArray = updated.configurations[1].arbitraryArray;
                assert.deepEqual(readArbitraryArray, writtenArbitraryArray);
            })
            it("throws if 'configurations' property is not an array", async function () {
                let currentConf = { configurations: "test" }
                setMockPackageType("Autobuild::CMake");
                fs.mkdirSync(join(pkgPath, ".vscode"));
                fs.writeFileSync(propertiesPath, JSON.stringify(currentConf));
                await assertThrowsAsync(subject.setupPackage(pkgPath),
                    /Invalid configuration/);

                let expectedData = JSON.stringify(currentConf);
                let actualData = fs.readFileSync(propertiesPath, "utf8");
                assert.equal(actualData, expectedData);
            })
        })
    })
    describe("addLaunchConfig()", function () {
        let launchConfigPath: string;
        let debugConfig: vscode.DebugConfiguration;
        beforeEach(function () {
            launchConfigPath = join(pkgPath, ".vscode",  "launch.json");
            helpers.registerFile('.vscode', 'launch.json');
            debugConfig = {
                name: "Test launch config",
                type: "cppdbg",
                request: "launch",
                program: "${rock:buildDir}/test/test_suite",
                stopAtEntry: false,
                cwd: "${workspaceRoot}"
            }
        })
        it("throws if existing file is invalid", async function () {
            fs.mkdirSync(join(pkgPath, ".vscode"));
            fs.writeFileSync(launchConfigPath, "dummyfile");
            assert.throws(() => subject.addLaunchConfig(pkgPath, debugConfig),
                /Could not load/)
            assert.equal(fs.readFileSync(launchConfigPath, "utf8"), "dummyfile");
        })
        it("creates the launch config file", async function () {
            await subject.addLaunchConfig(pkgPath, debugConfig);
            let data = {
                version: "0.2.0",
                configurations: [debugConfig],
            }
            let expectedData = JSON.stringify(data, null, 4);
            let actualData = fs.readFileSync(launchConfigPath, "utf8");
            assert.equal(actualData, expectedData);
        })
        it("updates an existing launch config file", async function () {
            let currentConf = {
                version: "0.2.0",
                configurations: [{}],
            }
            let expectedConfig = {
                version: "0.2.0",
                configurations: [{}],
            }
            currentConf.configurations[0] = Object.assign({}, debugConfig);
            expectedConfig.configurations[0] = Object.assign({}, currentConf.configurations[0]);
            expectedConfig.configurations.unshift(debugConfig);
            (expectedConfig.configurations[0] as any).name = "Test launch config 2";
            fs.mkdirSync(join(pkgPath, ".vscode"));
            fs.writeFileSync(launchConfigPath, JSON.stringify(currentConf));

            await subject.addLaunchConfig(pkgPath, debugConfig);
            let updated = JSON.parse(fs.readFileSync(launchConfigPath, "utf8"));
            assert.deepEqual(updated, expectedConfig);
        })
        it("throws if 'configurations' property is not an array", async function () {
            let currentConf = { configurations: "test" }
            fs.mkdirSync(join(pkgPath, ".vscode"));
            fs.writeFileSync(launchConfigPath, JSON.stringify(currentConf));
            assert.throws(() => subject.addLaunchConfig(pkgPath, debugConfig),
                /Invalid configuration/);

            let expectedData = JSON.stringify(currentConf);
            let actualData = fs.readFileSync(launchConfigPath, "utf8");
            assert.equal(actualData, expectedData);
        })
    })
    describe("updateCodeConfig()", function () {
        let mockSubject: TypeMoq.IMock<config.ConfigManager>;
        let mockConfiguration: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
        let mockSettings;
        beforeEach(function () {
            mockSettings = {
                "some.property": "string",
                "some.number": 31337,
                "some.boolean": true,
                "some.array": [2, 4, 6],
                "some.object": { key: "value" }
            }
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            mockConfiguration = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
            mockSubject.setup(x => x.suggestedSettings()).returns(() => mockSettings);
            mockWrapper.setup(x => x.getConfiguration()).returns(() => mockConfiguration.object);
            subject = mockSubject.target;
        })
        function verifyConfig(section: string, value: any,
            scope: vscode.ConfigurationTarget): void
        {
            mockConfiguration.verify(x => x.update(section, value,
                scope), TypeMoq.Times.once());
        }
        function testConfig(scope: vscode.ConfigurationTarget)
        {
            subject.updateCodeConfig(scope);
            mockWrapper.verify(x => x.getConfiguration(), TypeMoq.Times.once());
            verifyConfig("some.property", "string", scope);
            verifyConfig("some.number", 31337, scope);
            verifyConfig("some.boolean", true, scope);
            verifyConfig("some.array", [2, 4, 6], scope);
            verifyConfig("some.object", { key: "value" }, scope);
        }
        it("updates global configuration", function () {
            testConfig(vscode.ConfigurationTarget.Global);
        })
        it("updates workspace configuration", function () {
            testConfig(vscode.ConfigurationTarget.Workspace);
        })
    })
})
