'use strict'
import * as packages from '../src/packages'
import * as autoproj from '../src/autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode'
import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as context from '../src/context'
import * as tasks from '../src/tasks'
import * as status from '../src/status'
import * as wrappers from '../src/wrappers'
import * as debug from '../src/debug'
import * as async from '../src/async'
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

describe("Type", function() {
    describe("typePickerChoices", function() {
        it("does not contain any internal type", function() {
            packages.Type.typePickerChoices().forEach((choice) => {
                assert(!choice.type.isInternal());
            })
        })
    })
})

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
        s.mockWorkspaces.setup(x => x.isConfig(path)).returns(() => true)
        let aPackage = await subject.createPackage(path, s.context);
        assert(aPackage instanceof packages.ConfigPackage);
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
            helpers.registerFile('package', '.vscode', 'rock.json')
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
            it("returns the type set by the user even if there is no data in the workspace", async function () {
                s.mockContext.setup(x => x.getPackageType(path)).
                    returns(() => packages.Type.fromType(packages.TypeList.RUBY));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.RUBY));
            })
            it("returns the type set by the user, overriding what is in the workspace", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::CMake' });
                s.context.setPackageType(path, rubyType);
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("sets a null package info if the workspace doesn't have one", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::CMake' });
                mockWS.setup(x => x.info()).returns(() => Promise.resolve(emptyInfo));
                s.context.setPackageType(path, rubyType);
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal("Unknown", (aPackage as packages.RockPackage).info.type);
            })
            it("returns an OTHER package if the manifest has no type info and the user has not set a type", async function () {
                mockWS.setup(x => x.info()).returns(() => Promise.resolve(emptyInfo));
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, otherType);
            })
            it("returns the package type defined in the manifest", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.deepEqual(aPackage.type, rubyType);
            })
            it("embeds the containing workspace in the package objects", async function () {
                s.addPackageToManifest(ws, ['package'], { type: 'Autobuild::Ruby' });
                let aPackage = await subject.createPackage(path, s.context);
                assert.equal((aPackage as packages.RockPackage).ws, ws);
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
    let subject;
    beforeEach(function () {
        subject = new packages.InvalidPackage();
    })
    it("returns a valid string as its name", function () {
        assert.equal(subject.name, "(Invalid package)");
    })
    it("does not allow to debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Select a valid package/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Select a valid package/);
    })
    it("does not allow to pick a debugging target", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /Select a valid package/);
    })
    it("does not allow to pick the package type", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickType();
        }, /Select a valid package/);
    })
    it("returns an invalid package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.invalid());
    })
    it("does not allow debuging configurations", async function () {
        await assertThrowsAsync(async () => {
            await subject.customDebugConfiguration();
        }, /Select a valid package/);
    })
})

describe("ConfigPackage", function () {
    let subject;
    beforeEach(function () {
        subject = new packages.ConfigPackage("/path/to/package");
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /configuration package/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /configuration package/);
    })
    it("does not allow to pick a debugging target", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /configuration package/);
    })
    it("does not allow to pick the package type", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickType();
        }, /configuration package/);
    })
    it("returns the CONFIG package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.config());
    })
    it("does not allow debuging configurations", async function () {
        await assertThrowsAsync(async () => {
            await subject.customDebugConfiguration();
        }, /not available for configuration/);
    })
})

describe("ForeignPackage", function () {
    let subject;
    let mockContext: TypeMoq.IMock<context.Context>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        subject = new packages.ForeignPackage("/path/to/package",
            mockContext.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /not part of an autoproj workspace/);
    })
    it("does not allow debugging target picking", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /not part of an autoproj workspace/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.build();
        }, /not part of an autoproj workspace/);
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
    it("does not allow custom debugging configurations", async function () {
        await assertThrowsAsync(async () => {
            await subject.customDebugConfiguration();
        }, /not available for external/);
    })
})

describe("RockRubyPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;

    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockRubyPackage(
            mockBridge.object,
            new autoproj.Workspace("path", false),
            autoprojMakePackage('package', 'Autobuild::Ruby', "/path/to/package"),
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockWrapper.verify(x => x.runTask(task), TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        subject.pickTarget();
        mockContext.verify(x => x.pickDebuggingFile(subject.path), TypeMoq.Times.once());
    })

    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("starts a ruby debugging session", async function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            let userConf: context.RockDebugConfig = {
                cwd: subject.path,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: subject.path
                }
            }
            const type = packages.TypeList.RUBY;
            const options = {
                type: "Ruby",
                name: "rock debug",
                request: "launch",
                program: target.path,
                cwd: userConf.cwd,
                args: userConf.args,
            };
            mockContext.setup(x => x.debugConfig(subject.path)).returns(() => userConf);
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            await subject.debug();
            mockWrapper.verify(x => x.startDebugging(subject.path, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
    it("returns the RUBY package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.RUBY));
    })
    describe("customDebugConfiguration()", function () {
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
            assert(!await subject.customDebugConfiguration());
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

            const customDebugConfig = await subject.customDebugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
    })
})

describe("RockCXXPackage", function () {
    let subject: packages.RockCXXPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        let pkgInfo = autoprojMakePackage('package',
            'Autobuild::CMake', "/path/to/package");
        pkgInfo.builddir = "/path/to/package/build";
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockCXXPackage(
            new autoproj.Workspace("path", false), pkgInfo,
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockWrapper.verify(x => x.runTask(task),
            TypeMoq.Times.once());
    })
    describe("pickTarget()", function () {
        let mockSubject: TypeMoq.IMock<packages.RockCXXPackage>;
        beforeEach(function () {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        })
        it("sets the debugging target", async function () {
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.resolve("/path/to/package/build/test"));

            await subject.pickTarget();
            let debugTarget = new debug.Target("test", "/path/to/package/build/test");
            mockContext.verify(x => x.setDebuggingTarget(subject.path, debugTarget),
                TypeMoq.Times.once());
        })
        it("does nothing when canceled", async function () {
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.resolve(undefined));

            await subject.pickTarget();
            mockContext.verify(x => x.setDebuggingTarget(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })
    });
    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("starts a cxx debugging session", async function () {
            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = packages.TypeList.CXX;
            let userConf: context.RockDebugConfig = {
                cwd: subject.path,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: subject.path
                }
            }
            const options = {
                type: "cppdbg",
                name: "rock debug",
                request: "launch",
                program: target.path,
                externalConsole: false,
                MIMode: "gdb",
                cwd: userConf.cwd,
                args: userConf.args,
                setupCommands: [
                    {
                        description: "Enable pretty-printing for gdb",
                        text: "-enable-pretty-printing",
                        ignoreFailures: false
                    }
                ]
            };
            const uri = vscode.Uri.file(subject.path);
            let folder = {
                uri: vscode.Uri.file(subject.path),
                name: basename(subject.path),
                index: 0
            }
            mockContext.setup(x => x.debugConfig(subject.path)).returns(() => userConf);
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target);

            await subject.debug();
            mockWrapper.verify(x => x.startDebugging(subject.path, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
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
                mockWrapper.object, mockTaskProvider.object);
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
            assertThrowsAsync(function () {
                subject.listExecutables();
            }, /Did you build/);
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
    describe("customDebugConfiguration()", function () {
        let mockSubject: TypeMoq.IMock<packages.RockCXXPackage>;
        beforeEach(function () {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        })
        it("returns undefined if canceled", async function () {
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.resolve(undefined));
            assert(!await subject.customDebugConfiguration());
        })
        it("throws if executable picking fails", async function () {
            mockSubject.setup(x => x.pickExecutable()).
                returns(() => Promise.reject(new Error("test")));
            assertThrowsAsync(async function () {
                await subject.customDebugConfiguration();
            }, /^test$/);
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
            const customDebugConfig = await subject.customDebugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
    })
})

describe("RockOtherPackage", function () {
    let subject: packages.RockOtherPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockOtherPackage("/path/to/package",
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockWrapper.verify(x => x.runTask(task),
            TypeMoq.Times.once());
    })
    it("does not allow debugging target picking", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /Set the package type/);
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Set the package type/);
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
    it("returns the OTHER package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OTHER));
    })
})

describe("RockOrogenPackage", function () {
    let subject: packages.RockOrogenPackage;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        subject = new packages.RockOrogenPackage(
            mockBridge.object,
            new autoproj.Workspace("path", false),
            autoprojMakePackage('package', 'Autobuild::Orogen', "/path/to/package"),
            mockContext.object, mockWrapper.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        await subject.build();
        mockWrapper.verify(x => x.runTask(task),
            TypeMoq.Times.once());
    })
    describe("pickTarget()", function () {
        let mockSubject: TypeMoq.IMock<packages.RockOrogenPackage>;
        beforeEach(function () {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        })
        it("sets the debugging target", async function () {
            let task: async.IOrogenTask = {
                model_name: 'task1',
                deployment_name: "orogen_task1",
                file: '/some/bin/deployment/binfile'
            }
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(task));

            await subject.pickTarget();
            let debugTarget = new debug.Target("task1", '/some/bin/deployment/binfile');
            mockContext.verify(x => x.setDebuggingTarget(subject.path, debugTarget),
                TypeMoq.Times.once());
        })
        it("does nothing when canceled", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(undefined));

            await subject.pickTarget();
            mockContext.verify(x => x.setDebuggingTarget(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.never());
        })
    });
    describe("pickTask()", function () {
        it("throws if orogen project loading fails", async function () {
            let error = new Error("test");
            mockBridge.setup(x => x.describeOrogenProject(subject.path,
                subject.name)).returns(() => Promise.reject(error));
            await assertThrowsAsync(async () => {
                await subject.pickTask();
            }, /test/);
        })
        it("shows a quick pick ui and returns the selected task", async function () {
            let expectedChoices = new Array<any>();
            let task: async.IOrogenTask = {
                model_name: 'task1',
                deployment_name: "orogen_task1",
                file: '/some/bin/deployment/binfile'
            }
            expectedChoices.push({
                label: 'task1',
                description: '',
                task: task
            });

            mockBridge.setup(x => x.describeOrogenProject(subject.path, subject.name))
                .returns(() => Promise.resolve([ task ]));

            let choices;
            mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                callback(async (promisedChoices, ...ignored) => { choices = await promisedChoices }).
                returns(() => Promise.resolve(expectedChoices[0]));

            let selected = await subject.pickTask();
            assert.deepEqual(choices, expectedChoices);
            assert.deepEqual(selected, task);
        })
        it("shows a quick pick ui and returns undefined if canceled", async function () {
            let task: async.IOrogenTask = {
                model_name: 'task1',
                deployment_name: "orogen_task1",
                file: '/some/bin/deployment/binfile'
            }
            mockBridge.setup(x => x.describeOrogenProject(subject.path, subject.name))
                .returns(() => Promise.resolve([ task ]));
            mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(),
                TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));
            let selected = await subject.pickTask();
            assert.deepEqual(selected, undefined);
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        subject.pickType();
        mockContext.verify(x => x.pickPackageType(subject.path), TypeMoq.Times.once());
    })
    it("returns the OROGEN package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OROGEN));
    })
    describe("customDebugConfiguration()", function () {
        let mockSubject: TypeMoq.IMock<packages.RockOrogenPackage>;
        beforeEach(function () {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        })
        it("returns undefined if canceled", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(undefined));
            assert(!await subject.customDebugConfiguration());
        })
        it("throws if task picking fails", async function () {
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.reject(new Error("test")));
            assertThrowsAsync(async function () {
                await subject.customDebugConfiguration();
            }, /^test$/);
        })
        it("returns a debug configuration for the selected task", async function () {
            let task: async.IOrogenTask = {
                model_name: 'component::Task',
                deployment_name: "component",
                file: '/some/bin/deployment/binfile'
            }
            mockSubject.setup(x => x.pickTask()).
                returns(() => Promise.resolve(task));
            const expectedCustomDebugConfig: vscode.DebugConfiguration = {
                name: "component::Task",
                type: "orogen",
                request: "launch",
                task: "Task"
            }
            const customDebugConfig = await subject.customDebugConfiguration();
            assert.deepEqual(customDebugConfig, expectedCustomDebugConfig);
        })
    })
})
