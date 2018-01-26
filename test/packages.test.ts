'use strict'
import * as packages from '../src/packages'
import * as autoproj from '../src/autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode'
import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as context from '../src/context'
import * as tasks from '../src/tasks'
import * as wrappers from '../src/wrappers'
import * as debug from '../src/debug'
import * as syskit from '../src/syskit'
import { dirname, basename, join as joinPath, relative } from 'path'
import { assertThrowsAsync } from './helpers';
import * as fs from 'fs';

function autoprojMakePackage(name, type, path) {
    return {
        name: name,
        type: type,
        srcdir: path,
        builddir: '',
        prefix: '',
        vcs: { type: 'git', url: '', repository_id: '' },
        logdir: '',
        dependencies: []
    }
}

describe("PackageFactory", function () {
    let root: string;
    let s: helpers.TestSetup;
    let subject: packages.PackageFactory;
    beforeEach(function () {
        root = helpers.init();
        s = new helpers.TestSetup();
        subject = s.packageFactory;
    })
    afterEach(function () {
        helpers.clear();
    })
    it("creates a ConfigPackage for a package set", async function () {
        let path = '/path/to/package';
        let workspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
        s.mockWorkspaces.setup(x => x.isConfig(path)).returns(() => true);
        s.mockContext.setup(x => x.getWorkspaceByPath(path)).returns(() => workspace.object);
        let aPackage = await subject.createPackage(path, s.context);
        assert(aPackage instanceof packages.ConfigPackage);
        assert.equal(aPackage.name, "package");
        assert.strictEqual(aPackage.workspace, workspace.object);
    })
    it("creates an InvalidPackage if package is not in vscode ws", async function () {
        let path = '/path/to/package';
        s.mockWrapper.setup(x => x.getWorkspaceFolder(path)).
            returns(() => undefined);
        let aPackage = await subject.createPackage(path, s.context);
        assert.equal(aPackage.name, '(Invalid package)');
    })
    describe("the package is neither invalid nor a configuration", function () {
        let path;
        let folder: vscode.WorkspaceFolder;
        beforeEach(function() {
            path = helpers.mkdir('package');
            helpers.registerDir('package', '.vscode');
            folder = {
                uri: vscode.Uri.file(path),
                name: 'package',
                index: 0
            }
            s.mockWrapper.setup(x => x.getWorkspaceFolder(path)).
                returns(() => folder)
        })
        it("creates a ForeignPackage if the package is not in an autoproj ws", async function () {
            s.mockContext.
                setup(x => x.getWorkspaceByPath(path)).returns(() => undefined)

            let aPackage = await subject.createPackage(path, s.context);
            assert(aPackage instanceof packages.ForeignPackage);
            assert.equal(aPackage.name, basename(path));
        })
        describe("the package is in an autoproj workspace", function () {
            let mockWS: TypeMoq.IMock<autoproj.Workspace>;
            let ws: autoproj.Workspace;
            let emptyInfo: autoproj.WorkspaceInfo;
            const rubyType = packages.Type.fromType(packages.TypeList.RUBY)
            const otherType = packages.Type.fromType(packages.TypeList.OTHER)
            beforeEach(async function () {
                let created = s.createAndRegisterWorkspace('test');
                mockWS = created.mock;
                ws = created.ws;
                s.mockContext.setup(x => x.getWorkspaceByPath(path)).
                    returns((path) => ws);
                emptyInfo = new autoproj.WorkspaceInfo(ws.root);
                mockWS.setup(x => x.envsh()).returns(() => Promise.resolve(emptyInfo));
            })
            it("sets a null package info if the workspace doesn't have one", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::CMake' });
                mockWS.setup(x => x.info()).returns(() => Promise.resolve(emptyInfo));
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal("Unknown", (aPackage as packages.RockPackage).info.type);
                assert.equal(aPackage.name, relative(ws.root, path));
            })
            it("returns an OTHER package if the manifest has no type info", async function () {
                mockWS.setup(x => x.info()).returns(() => Promise.resolve(emptyInfo));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, otherType);
            })
            it("returns the package type defined in the manifest", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("returns the package name defined in the manifest", async function () {
                let pkgInfo = s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal(aPackage.name, pkgInfo.name);
            })
            it("embeds the containing workspace in the package objects", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal(aPackage.workspace, ws);
            })
            it("attempts to regenerate the manifest if the package is not present in it", async function() {
                mockWS.setup(x => x.envsh()).
                    returns(() => {
                        s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' })
                        return ws.reload();
                    });
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("returns OTHER if the package is not in the manifest even after reloading", async function () {
                mockWS.setup(x => x.envsh()).returns(() => Promise.resolve(emptyInfo));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, otherType);
            })
        })
    })
})

describe("InvalidPackage", function () {
    let subject: packages.InvalidPackage;
    beforeEach(function () {
        subject = new packages.InvalidPackage();
    })
    it("returns a valid string as its name", function () {
        assert.equal(subject.name, "(Invalid package)");
    })
    it("returns an invalid package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.invalid());
    })
    it("does not allow debugging configurations", async function () {
        await assertThrowsAsync(subject.debugConfiguration(),
            /Select a valid package/);
    })
    it("returns an undefined workspace", function () {
        assert(!subject.workspace);
    });
})

describe("ConfigPackage", function () {
    let subject: packages.ConfigPackage;
    let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
    beforeEach(function () {
        mockWorkspace = TypeMoq.Mock.ofType<autoproj.Workspace>();
        subject = new packages.ConfigPackage("/path/to/package",
            mockWorkspace.object);
    })
    it("returns the given workspace", function () {
        assert.strictEqual(subject.workspace, mockWorkspace.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the CONFIG package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.config());
    })
    it("does not allow debuging configurations", async function () {
        await assertThrowsAsync(subject.debugConfiguration(),
            /not available for configuration/);
    })
    it("returns the given workspace", function () {
        assert.strictEqual(subject.workspace, mockWorkspace.object);
    });
})

describe("ForeignPackage", function () {
    let subject: packages.ForeignPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        subject = new packages.ForeignPackage("/path/to/package",
            mockContext.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow custom debugging configurations", async function () {
        await assertThrowsAsync(subject.debugConfiguration(),
            /not available for external/);
    })
    it("returns an undefined workspace", function () {
        assert(!subject.workspace);
    });
    it("returns the OTHER package type", function () {
        assert.equal(subject.type.id, packages.TypeList.OTHER.id);
    });
})

describe("RockRubyPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.AutoprojProvider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let workspace: autoproj.Workspace;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.AutoprojProvider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        workspace = new autoproj.Workspace("path", false);
        subject = new packages.RockRubyPackage(workspace,
            autoprojMakePackage('package', 'Autobuild::Ruby', "/path/to/package"),
            mockContext.object, mockWrapper.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, subject.info.name);
    })
    it("returns the RUBY package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.RUBY));
    })
    describe("debugConfiguration()", function () {
        it("returns undefined if canceled", async function () {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                defaultUri: vscode.Uri.file(subject.path),
                openLabel: "Debug file"
            };
            mockWrapper.setup(x => x.showOpenDialog(options)).
                returns(() => Promise.resolve(undefined));
            assert(!await subject.debugConfiguration());
        })
        it("returns a debug configuration for the selected file", async function () {
            const uri = vscode.Uri.file(joinPath(subject.path, "test.rb"));
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                defaultUri: vscode.Uri.file(subject.path),
                openLabel: "Debug file"
            };
            const expectedCustomDebugConfig: vscode.DebugConfiguration = {
                type: "Ruby",
                name: relative(subject.path, uri.fsPath),
                request: "launch",
                program: uri.fsPath
            };
            mockWrapper.setup(x => x.showOpenDialog(options)).
                returns(() => Promise.resolve([uri]));

            const customDebugConfig = await subject.debugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
    })
    it("returns the given workspace", function () {
        assert.strictEqual(subject.workspace, workspace);
    });
})

describe("RockCXXPackage", function () {
    let subject: packages.RockCXXPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.AutoprojProvider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let workspace: autoproj.Workspace;
    beforeEach(function () {
        workspace = new autoproj.Workspace("path", false);
        let pkgInfo = autoprojMakePackage('package',
            'Autobuild::CMake', "/path/to/package");
        pkgInfo.builddir = "/path/to/package/build";
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.AutoprojProvider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockCXXPackage(workspace, pkgInfo,
            mockContext.object, mockWrapper.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, subject.info.name);
    })
    it("returns the CXX package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.CXX));
    })
    describe("listExecutables()", function () {
        let pkgPath: string;
        let pkgInfo: autoproj.Package;
        let files: string[];
        function createSubject() {
            subject = new packages.RockCXXPackage(
                new autoproj.Workspace(pkgPath, false),
                pkgInfo, mockContext.object,
                mockWrapper.object);
        }
        beforeEach(function () {
            pkgPath = helpers.init();
            pkgInfo = autoprojMakePackage('package', 'Autobuild::CMake', pkgPath);
            createSubject();
        })
        afterEach(function () {
            helpers.clear();
        })
        function createDummyExecutables() {
            helpers.mkdir('.hidden');
            helpers.mkdir('CMakeFiles');
            helpers.mkdir('subdir');

            files = [];
            files.push(helpers.mkfile('', 'suite'));
            files.push(helpers.mkfile('', '.hidden', 'suite'));
            files.push(helpers.mkfile('', 'CMakeFiles', 'suite'));
            files.push(helpers.mkfile('', 'subdir', 'test'));
            files.push(helpers.mkfile('', 'libtool'));
            files.push(helpers.mkfile('', 'configure'));
            files.push(helpers.mkfile('', 'config.status'));
            files.push(helpers.mkfile('', 'lib.so'));
            files.push(helpers.mkfile('', 'lib.so.1'));
            files.push(helpers.mkfile('', 'lib.so.1.2'));
            files.push(helpers.mkfile('', 'lib.so.1.2.3'));
            files.push(helpers.mkfile('', 'file.rb'));
            files.push(helpers.mkfile('', 'file.py'));
            files.push(helpers.mkfile('', 'file.sh'));
            for (let file of files)
                fs.chmodSync(file, 0o755);
            files.push(helpers.mkfile('', 'test'));
            pkgInfo.builddir = pkgPath;
            createSubject();
        }
        it("lists executables recursively", async function () {
            createDummyExecutables();
            const execs = await subject.listExecutables();
            assert.equal(execs.length, 2);
            assert(execs.some(file => file == files[0]));
            assert(execs.some(file => file == files[3]));
        });
        it("throws if builddir does not exist", async function () {
            pkgInfo.builddir = '/path/not/found';
            createSubject();
            await assertThrowsAsync(subject.listExecutables(),
                /Did you build/);
        })
    });
    describe("pickExecutable()", function () {
        let mockSubject: TypeMoq.IMock<packages.RockCXXPackage>;
        let executables: string[];
        beforeEach(function () {
            executables = [];
            executables.push('/path/to/package/build/test');
            executables.push('/path/to/package/build/other_test');
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            mockSubject.setup(x => x.listExecutables()).
                returns(() => Promise.resolve(executables));
            subject = mockSubject.target;
        })
        it("shows a picker and returns the selected executable", async function () {
            let choices: { label: string, description: string, path: string }[] = [];
            let expectedChoices: { label: string, description: string, path: string }[] = [];
            for (let choice of executables) {
                expectedChoices.push({
                    label: basename(choice),
                    description: relative(subject.info.builddir, dirname(choice)),
                    path: choice
                });
            }
            mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                callback(async (promisedChoices, ...ignored) => { choices = await promisedChoices }).
                returns(() => Promise.resolve(expectedChoices[0]));

            let chosen = await subject.pickExecutable();
            assert.deepEqual(choices, expectedChoices);
            assert.equal(chosen, executables[0]);
        });
        it("returns undefined if canceled by the user", async function () {
            mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));

            let chosen = await subject.pickExecutable();
            assert(!chosen);
        })
    })
    describe("debugConfiguration()", function () {
        let mockSubject: TypeMoq.IMock<packages.RockCXXPackage>;
        beforeEach(function () {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        })
        it("returns undefined if canceled", async function () {
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.resolve(undefined));
            assert(!await subject.debugConfiguration());
        })
        it("throws if executable picking fails", async function () {
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.reject(new Error("test")));
            await assertThrowsAsync(subject.debugConfiguration(),
                /^test$/);
        })
        it("returns a debug configuration for the selected executable", async function () {
            const executable = joinPath(subject.info.builddir, "test_suite");
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.resolve(executable));
            let expandablePath = relative(subject.info.builddir, executable);
            expandablePath = joinPath("${rock:buildDir}", expandablePath);
            const expectedCustomDebugConfig: vscode.DebugConfiguration = {
                type: "cppdbg",
                name: relative(subject.info.builddir, executable),
                request: "launch",
                program: expandablePath,
                cwd: "${rock:buildDir}",
                MIMode: "gdb",
                setupCommands: [
                    {
                        description: "Enable pretty-printing for gdb",
                        text: "-enable-pretty-printing",
                        ignoreFailures: false
                    }
                ]
            };
            const customDebugConfig = await subject.debugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
    })
    it("returns the given workspace", function () {
        assert.strictEqual(subject.workspace, workspace);
    });
})

describe("RockOtherPackage", function () {
    let subject: packages.RockOtherPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.AutoprojProvider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let pkgInfo: autoproj.Package;
    let workspace: autoproj.Workspace;
    function nullPackageInfo(path: string)
    {
        let result : autoproj.Package = {
            name: path,
            type: 'Unknown',
            vcs: { type: 'unknown', url: 'unknown', repository_id: 'unknown' },
            srcdir: path,
            builddir: path,
            logdir: path,
            prefix: path,
            dependencies: []
        };
        return result;
    }
    beforeEach(function () {
        pkgInfo = nullPackageInfo("/path/to/package");
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.AutoprojProvider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        workspace = new autoproj.Workspace("path", false);
        subject = new packages.RockOtherPackage(workspace,
            pkgInfo, mockContext.object, mockWrapper.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, subject.info.name);
    })
    it("returns the OTHER package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OTHER));
    })
    it("returns the given workspace", function () {
        assert.strictEqual(subject.workspace, workspace);
    });
    it("does not allow creating debug configuration", async function () {
        assertThrowsAsync(async function () {
            await subject.debugConfiguration();
        }, /package type unknown/);
    })
})

describe("RockOrogenPackage", function () {
    let s : helpers.TestSetup;
    let subject : packages.RockOrogenPackage;
    let workspace : autoproj.Workspace;
    let mockSyskit : TypeMoq.IMock<syskit.Connection>;

    beforeEach(function () {
        helpers.init();
        s = new helpers.TestSetup();
        let { mock, ws } = s.createAndRegisterWorkspace('ws');
        mockSyskit = helpers.mockSyskitConnection(mock);
        workspace = ws;
        subject = new packages.RockOrogenPackage(
            workspace,
            autoprojMakePackage('package', 'Autobuild::Orogen', "/path/to/package"),
            s.context, s.wrapper);
    })
    afterEach(function () {
        helpers.clear();
    });
    it("returns the basename", function () {
        assert.equal(subject.name, subject.info.name);
    })
    describe("pickTask()", function () {
        let deployments : syskit.AvailableDeployment[] = [
            {
                name: 'test_deployment',
                project_name: 'test',
                default_deployment_for: 'test::Task',
                default_logger: undefined,
                tasks: []
            }
        ]

        it("shows a quick pick ui and returns the selected task", async function () {
            let expectedChoices = new Array<any>();
            expectedChoices.push({
                label: 'test::Task',
                description: '',
                orogen_info: deployments[0]
            });
            mockSyskit.setup(x => x.availableDeployments()).
                returns(() => Promise.resolve(deployments));

            let choices;
            s.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                callback(async (promisedChoices, ...ignored) => { choices = await promisedChoices }).
                returns(() => Promise.resolve(expectedChoices[0]));

            let selected = await subject.pickTask();
            assert.deepStrictEqual(choices, expectedChoices);
            assert.deepStrictEqual(selected, deployments[0]);
        })
        it("shows a quick pick ui and returns undefined if canceled", async function () {
            mockSyskit.setup(x => x.availableDeployments()).
                returns(() => Promise.resolve(deployments));
            s.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));
            let selected = await subject.pickTask();
            assert.deepEqual(selected, undefined);
        })
    })
    it("returns the OROGEN package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OROGEN));
    })
    describe("debugConfiguration()", function () {
        let deployments : syskit.AvailableDeployment[] = [
            {
                name: 'test_deployment',
                project_name: 'test',
                default_deployment_for: 'test::Task',
                default_logger: undefined,
                tasks: []
            },
            {
                name: 'test_deployment',
                project_name: 'test',
                default_deployment_for: undefined,
                default_logger: undefined,
                tasks: []
            }
        ]
        let mockSubject: TypeMoq.IMock<packages.RockOrogenPackage>;
        beforeEach(function () {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        })
        it("returns undefined if canceled", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(undefined));
            assert(!await subject.debugConfiguration());
        })
        it("throws if task picking fails", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.reject(new Error("test")));
            await assertThrowsAsync(subject.debugConfiguration(),
                /^test$/);
        })
        it("returns a debug configuration for a selected orogen model", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(deployments[0]));
            const expectedCustomDebugConfig: vscode.DebugConfiguration = {
                name: "orogen - test::Task",
                type: "orogen",
                request: "launch",
                deploy: "test::Task",
                deployAs: "task",
                externalConsole: true,
                stopAtEntry: false,
                cwd: '${workspaceRoot}'
            }
            const customDebugConfig = await subject.debugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
        it("returns a debug configuration for a selected deployment", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(deployments[1]));
            const expectedCustomDebugConfig: vscode.DebugConfiguration = {
                name: "orogen - test_deployment",
                type: "orogen",
                request: "launch",
                deploy: "test_deployment",
                externalConsole: true,
                stopAtEntry: false,
                cwd: '${workspaceRoot}'
            }
            const customDebugConfig = await subject.debugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
    })
    it("returns the given workspace", function () {
        assert.strictEqual(subject.workspace, workspace);
    });
})
