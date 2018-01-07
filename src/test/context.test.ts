'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../wrappers';
import * as tasks from '../tasks';
import * as context from '../context';
import * as autoproj from '../autoproj';
import * as helpers from './helpers';
import * as packages from '../packages';
import * as async from '../async';
import { basename, join } from 'path';
import * as fs from 'fs'
import * as debug from '../debug'

class TestContext
{
    root: string;
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    mockPackageFactory: TypeMoq.IMock<packages.PackageFactory>;
    mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    workspaces: autoproj.Workspaces;

    mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
    workspaceFolders: vscode.WorkspaceFolder[];
    mockTextEditor: TypeMoq.IMock<vscode.TextEditor>;

    subject: context.Context;
    private _activeDocumentURI : vscode.Uri | undefined;
    constructor()
    {
        this.root = helpers.init();
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockWrapper.setup(x => x.workspaceFolders)
            .returns(() => this.workspaceFolders);
        this.mockWrapper.setup(x => x.activeDocumentURI)
            .returns(() => this._activeDocumentURI);
        this.mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        let taskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        this.mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        let packageFactory = new packages.PackageFactory(this.mockWrapper.object, taskProvider.object, this.mockBridge.object);
        this.mockPackageFactory = TypeMoq.Mock.ofInstance(packageFactory);
        this.mockPackageFactory.callBase = true;
        this.workspaces = new autoproj.Workspaces;

        this.subject = new context.Context(
            this.mockWrapper.object,
            this.workspaces,
            this.mockPackageFactory.object);

        this.mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
    }

    clear(): void
    {
        try
        {
            fs.unlinkSync(join(this.root, '.vscode', 'rock.json'));
            fs.rmdirSync(join(this.root, '.vscode'));
        }
        catch {}
        helpers.clear();
    }

    addWorkspaceConfiguration(section: string, path?: string): void
    {
        if (path)
        {
            let resource = vscode.Uri.file(path);
            this.mockWrapper.setup(x => x.getConfiguration(section, resource))
                .returns(() => this.mockWorkspaceConf.object);
        } else
        {
            this.mockWrapper.setup(x => x.getConfiguration(section))
                .returns(() => this.mockWorkspaceConf.object);
        }
    }

    addConfigurationValue<T>(section: string, value: T): void
    {
        this.mockWorkspaceConf.setup(x => x.get(section))
            .returns(() => value);
    }

    addPackageFactory(path: string): packages.Package
    {
        let mockPackage = TypeMoq.Mock.ofType<packages.Package>();
        mockPackage.setup((x: any) => x.then).returns(() => undefined);

        this.mockPackageFactory.setup(x => x.createPackage(path, TypeMoq.It.isAny())).
            returns(() => Promise.resolve(mockPackage.object));

        return mockPackage.object;
    }

    addCodeWorkspaceFolder(path: string): void
    {
        if (!this.workspaceFolders) {
            this.workspaceFolders = [];
        }

        let folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(path),
            name: basename(path),
            index: this.workspaceFolders.length
        };

        this.workspaceFolders.push(folder);
    }

    addWorkspaceState<T>(key: string, value: string): void
    {
        this.mockWrapper.setup(x => x.getWorkspaceState(key))
            .returns(() => value);
    }

    openEditor(uri: string): vscode.Uri
    {
        let resource = vscode.Uri.parse(uri);
        this._activeDocumentURI = resource;
        return resource;
    }

    closeEditor()
    {
        this._activeDocumentURI = undefined;
    }

    createWorkspace(workspaceName: string) {
        helpers.mkdir(workspaceName, '.autoproj');
        helpers.mkfile('', workspaceName, ".autoproj", "installation-manifest");
    }
    registerPackage(workspaceName : string, ...packageName: string[]) {
        let path = helpers.mkdir(workspaceName, join(...packageName));
        let ws = this.workspaces.addFolder(path);
        return { ws, path };
    }
    associateResourceWithFolder(resource: vscode.Uri,
        folder: vscode.WorkspaceFolder): void
    {
        this.mockWrapper.setup(x => x.getWorkspaceFolder(resource)).
            returns(() => folder);
    }
}

describe("Context tests", function () {
    let testContext: TestContext;
    beforeEach(function () {
        testContext = new TestContext;
    })
    afterEach(function () {
        testContext.clear();
    })

    function verifyContextUpdated(times) {
        const mock = TypeMoq.Mock.ofInstance(() => undefined);
        mock.object();
        testContext.subject.onUpdate(mock);
        mock.verify(x => x(), times);
    }

    function loadRockJson()
    {
        let path = join(testContext.root, '.vscode', 'rock.json');
        let writtenData: context.PackageInternalData;
        let jsonString = fs.readFileSync(path, 'utf8');
        writtenData = JSON.parse(jsonString);
        return writtenData;
    }
    describe("setPackageType", function () {
        it("writes a json file with the type only", function () {
            let type = packages.Type.fromName("ruby");
            testContext.subject.setPackageType(testContext.root, type);
            let writtenData = loadRockJson();

            assert.equal(writtenData.type, "ruby");
            assert.equal(writtenData.debuggingTarget.name, undefined);
            assert.equal(writtenData.debuggingTarget.path, undefined);
            verifyContextUpdated(TypeMoq.Times.once());
        })
        it("writes a json file with the type keeping previous data", function () {
            let type = packages.Type.fromName("cxx");
            let previous = {
                debuggingTarget: {
                    name: 'target',
                    path: '/path/to/target'
                }
            }
            fs.mkdirSync(join(testContext.root, '.vscode'));
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), JSON.stringify(previous));
            testContext.subject.setPackageType(testContext.root, type);

            let writtenData = loadRockJson();
            assert.equal(writtenData.type, "cxx");
            assert.equal(writtenData.debuggingTarget.name, "target");
            assert.equal(writtenData.debuggingTarget.path, "/path/to/target");
            verifyContextUpdated(TypeMoq.Times.once());
        })
        it("writes a json file with the type discarding previous data", function () {
            let type = packages.Type.fromName("cxx");
            let previous = "invalid json";
            fs.mkdirSync(join(testContext.root, '.vscode'));
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), previous);
            testContext.subject.setPackageType(testContext.root, type);

            let writtenData = loadRockJson();
            assert.equal(writtenData.type, "cxx");
            assert.equal(writtenData.debuggingTarget.name, undefined);
            assert.equal(writtenData.debuggingTarget.path, undefined);
            verifyContextUpdated(TypeMoq.Times.once());
        })
    })
    describe("getPackageType", function () {
        function writeJson(type: string)
        {
            let jsonData = JSON.stringify({ type: type });
            fs.mkdirSync(join(testContext.root, '.vscode'), 0o755);
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), jsonData);
        }
        it("reads the package type from the json file", function () {
            writeJson("orogen");
            let type = testContext.subject.getPackageType(testContext.root) as packages.Type;
            assert.equal(type.name, "orogen");
        })
        it("returns OTHER if the type is invalid", function () {
            writeJson("invalid package type");
            let type = testContext.subject.getPackageType(testContext.root) as packages.Type;
            assert.equal(type.name, "other");
        })
        it("returns undefined if the file is missing", function () {
            let type = testContext.subject.getPackageType(testContext.root);
            assert.equal(type, undefined);
        })
        it("returns undefined if the type is unset", function () {
            fs.mkdirSync(join(testContext.root, '.vscode'), 0o755);
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'),
                JSON.stringify({ data: "garbage" }));
            let type = testContext.subject.getPackageType(testContext.root);
            assert.equal(type, undefined);
        })
        it("returns undefined if the file is invalid", function () {
            fs.mkdirSync(join(testContext.root, '.vscode'), 0o755);
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), "corrupted data");
            let type = testContext.subject.getPackageType(testContext.root);
            assert.equal(type, undefined);
        })
    })
    describe("setDebuggingTarget", function () {
        it("writes a json file with the target only", function () {
            let target = new debug.Target("target", "/path/to/target");
            testContext.subject.setDebuggingTarget(testContext.root, target);
            let writtenData = loadRockJson();

            assert.equal(writtenData.type, undefined);
            assert.equal(writtenData.debuggingTarget.name, "target");
            assert.equal(writtenData.debuggingTarget.path, "/path/to/target");
            verifyContextUpdated(TypeMoq.Times.once());
        })
        it("writes a json file with the target keeping previous data", function () {
            let previous = { type: "orogen" }
            let target = new debug.Target("target", "/path/to/target");
            fs.mkdirSync(join(testContext.root, '.vscode'));
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), JSON.stringify(previous));
            testContext.subject.setDebuggingTarget(testContext.root, target);

            let writtenData = loadRockJson();
            assert.equal(writtenData.type, "orogen");
            assert.equal(writtenData.debuggingTarget.name, "target");
            assert.equal(writtenData.debuggingTarget.path, "/path/to/target");
            verifyContextUpdated(TypeMoq.Times.once());
        })
        it("writes a json file with the type discarding previous data", function () {
            let previous = { type: "orogen" }
            let target = new debug.Target("target", "/path/to/target");
            fs.mkdirSync(join(testContext.root, '.vscode'));
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), "invalid data");
            testContext.subject.setDebuggingTarget(testContext.root, target);

            let writtenData = loadRockJson();
            assert.equal(writtenData.type, undefined);
            assert.equal(writtenData.debuggingTarget.name, "target");
            assert.equal(writtenData.debuggingTarget.path, "/path/to/target");
            verifyContextUpdated(TypeMoq.Times.once());
        })
    })
    describe("getDebuggingTarget", function () {
        function writeJson(name: string | undefined, path: string | undefined)
        {
            let jsonData = JSON.stringify({ debuggingTarget: { name: name, path: path }});
            fs.mkdirSync(join(testContext.root, '.vscode'), 0o755);
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), jsonData);
        }
        it("reads the package type from the json file", function () {
            writeJson("target", "/path/to/target");
            let target = testContext.subject.getDebuggingTarget(testContext.root) as debug.Target;
            assert.equal(target.name, "target");
            assert.equal(target.path, "/path/to/target");
        })
        it("returns undefiend name is missing", function () {
            writeJson(undefined, "/path/to/json");
            let target = testContext.subject.getDebuggingTarget(testContext.root);
            assert.equal(target, undefined);
        })
        it("returns undefiend path is missing", function () {
            writeJson("target", undefined);
            let target = testContext.subject.getDebuggingTarget(testContext.root);
            assert.equal(target, undefined);
        })
        it("returns undefined if the target is unset", function () {
            fs.mkdirSync(join(testContext.root, '.vscode'), 0o755);
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'),
                JSON.stringify({ data: "garbage" }));
            let target = testContext.subject.getDebuggingTarget(testContext.root);
            assert.equal(target, undefined);
        })
        it("returns undefined if the file is invalid", function () {
            fs.mkdirSync(join(testContext.root, '.vscode'), 0o755);
            fs.writeFileSync(join(testContext.root, '.vscode', 'rock.json'), "corrupted data");
            let target = testContext.subject.getDebuggingTarget(testContext.root);
            assert.equal(target, undefined);
        })
    })

    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });

    it("gets the package selection mode", function () {
        testContext.addWorkspaceConfiguration('rock');
        testContext.addConfigurationValue('packageSelectionMode', "auto");

        let selectionMode = testContext.subject.packageSelectionMode;
        assert.equal(selectionMode, "auto");
    });
    it("gets the debugging configuration", function () {
        let config: context.RockDebugConfig = {
            cwd: '/a/path/to/something',
            args: ["--test", "--argument"],
            orogen: {
                start: true,
                gui: true,
                confDir: '/some/path'
            }
        }
        testContext.addWorkspaceConfiguration('rock', '/the/package');
        testContext.addConfigurationValue('debug', config);

        let debugConfig = testContext.subject.debugConfig('/the/package');
        assert.deepEqual(debugConfig, config);
    });
    it("sets the selected package and fires the event", function () {
        let path = '/path/to/package';
        testContext.subject.setSelectedPackage(path);

        testContext.mockWrapper.verify(x =>
            x.updateWorkspaceState('rockSelectedPackage', path), TypeMoq.Times.once());

        verifyContextUpdated(TypeMoq.Times.once());
    });

    describe("getSelectedWorkspace", function() {
        beforeEach(function() {
            testContext.createWorkspace('test');
        })

        function setSelectedPackage(typeName, path) {
            let contextMock = TypeMoq.Mock.ofInstance(testContext.subject);
            contextMock.callBase = true;
            let pkg = TypeMoq.Mock.ofType<packages.Package>();
            pkg.setup(x => x.type).returns(() => packages.Type.fromName(typeName));
            pkg.setup(x => x.path).returns(() => path);
            pkg.setup((x: any) => x.then).returns(() => undefined);
            contextMock.setup(x => x.getSelectedPackage()).returns(() => Promise.resolve(pkg.object));
            return contextMock;
        }

        it ("returns the package's workspace if there is a selected package", async function() {
            let { ws, path }  = testContext.registerPackage('test', 'package');
            let contextMock = setSelectedPackage('cxx', path);
            let selectedWs = await contextMock.object.getSelectedWorkspace();
            assert.deepEqual(selectedWs, ws);
        })

        it ("returns a configuration workspace's", async function() {
            let { ws, path }  = testContext.registerPackage('test', 'package');
            let contextMock = setSelectedPackage('config', path);
            let selectedWs = await contextMock.object.getSelectedWorkspace();
            assert.deepEqual(selectedWs, ws);
        })

        it ("returns undefined if the selected package is invalid", async function() {
            let { ws, path }  = testContext.registerPackage('test', 'package');
            let contextMock = setSelectedPackage('invalid', path);
            let selectedWs = await contextMock.object.getSelectedWorkspace();
            assert.equal(selectedWs, undefined);
        })

        it ("returns undefined if the selected package is not part of a workspace", async function() {
            let contextMock = setSelectedPackage('invalid', 'package');
            let selectedWs = await contextMock.object.getSelectedWorkspace();
            assert.equal(selectedWs, undefined);
        })
    })

    describe("get selectedPackage", function() {
        describe("on an empty workspace", function() {
            it("creates an invalid package", async function () {
                let pkg = await testContext.subject.getSelectedPackage();
                assert(!pkg.type.isValid());
            });
        })
        describe("on a non-empty workspace", function() {
            beforeEach(function () {
                testContext.addCodeWorkspaceFolder('/my/workspace/foo');
                testContext.addCodeWorkspaceFolder('/my/workspace/bar');
            })
            describe("in manual package selection mode", function() {
                beforeEach(function () {
                    testContext.addWorkspaceConfiguration('rock');
                    testContext.addConfigurationValue('packageSelectionMode', 'manual');
                })
                it("creates an invalid package if no package is selected", async function () {
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert(!pkg.type.isValid());
                });
                it("creates an invalid package if the selected package no longer belongs to workspace", async function () {
                    testContext.addWorkspaceState('rockSelectedPackage', '/a/foreign/package');

                    let pkg = await testContext.subject.getSelectedPackage();
                    assert(!pkg.type.isValid());
                });
                it("creates the package representation", async function () {
                    testContext.addWorkspaceState('rockSelectedPackage', '/my/workspace/foo');

                    let mock = testContext.addPackageFactory('/my/workspace/foo');
                    let pkg = await testContext.subject.getSelectedPackage();

                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage('/my/workspace/foo', testContext.subject),
                        TypeMoq.Times.once());
                });
            })
            describe("in auto package selection mode", function() {
                beforeEach(function () {
                    testContext.addWorkspaceConfiguration('rock');
                    testContext.addConfigurationValue('packageSelectionMode', 'auto');
                })
                it("creates an invalid package if no file is being edited", async function () {
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert(!pkg.type.isValid());
                });
                it("creates an invalid package if the file's uri scheme is not 'file'", async function () {
                    testContext.openEditor('ftp://ftp.foo.com/bar/');
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert(!pkg.type.isValid());
                });
                it("creates an invalid package if the file does not belong to any package", async function () {
                    testContext.openEditor('file:///a/foreign/package');
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert(!pkg.type.isValid());
                });
                it("auto selects the package in single root workspaces", async function () {
                    testContext.workspaceFolders.pop();
                    let pkgPath = testContext.workspaceFolders[0].uri.fsPath;
                    let mock = testContext.addPackageFactory(pkgPath);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage(pkgPath, testContext.subject), TypeMoq.Times.once());
                });
                it("creates the package representation of the package that owns the file", async function () {
                    let resource = testContext.openEditor('file://my/workspace/foo/file.cpp');
                    let mock = testContext.addPackageFactory('/my/workspace/foo');
                    testContext.associateResourceWithFolder(resource, testContext.workspaceFolders[0]);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage('/my/workspace/foo', testContext.subject),
                        TypeMoq.Times.once());
                });
                it("returns a cached package if current is invalid", async function () {
                    testContext.addCodeWorkspaceFolder('/my/workspace/package');
                    let resource = testContext.openEditor('file://my/workspace/foo/file.cpp');
                    let mock = testContext.addPackageFactory('/my/workspace/foo');
                    testContext.associateResourceWithFolder(resource, testContext.workspaceFolders[0]);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);

                    testContext.closeEditor();
                    pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);

                    testContext.workspaceFolders.shift();
                    pkg = await testContext.subject.getSelectedPackage();
                    assert(!pkg.type.isValid());
                });
            })
        })
    })

    describe("pickPackageType", function() {
        let packagePath : string;

        beforeEach(function() {
            packagePath = helpers.mkdir('package');
            helpers.registerDir('package', '.vscode');
            helpers.registerFile('package', '.vscode', 'rock.json');
        })

        it("selects the package type from the user-selected type", async function() {
            let expectedChoices = packages.Type.typePickerChoices();
            let packageType = {
                label: 'Ruby',
                description: '',
                type: packages.Type.fromType(packages.TypeList.RUBY)
            }
            testContext.mockWrapper.setup(x => x.showQuickPick(expectedChoices, TypeMoq.It.isAny())).
                returns(() => Promise.resolve(packageType));

            await testContext.subject.pickPackageType(packagePath);
            const selectedPackageType = testContext.subject.getPackageType(packagePath);
            assert(selectedPackageType);
            if (selectedPackageType) {
                assert.equal(selectedPackageType.id, packages.TypeList.RUBY.id);
            }
        })

        it("does not modify the selection if the picker is cancelled", async function() {
            testContext.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));

            testContext.subject.setPackageType(packagePath, packages.Type.fromName('cxx'));
            await testContext.subject.pickPackageType(packagePath);
            const selectedPackageType = testContext.subject.getPackageType(packagePath);
            assert.deepEqual(selectedPackageType, packages.Type.fromName('cxx'));
        })
    })

    describe("pickDebuggingTarget", function() {
        let packagePath : string;

        beforeEach(function() {
            packagePath = helpers.mkdir('package');
            helpers.registerDir('package', '.vscode');
            helpers.registerFile('package', '.vscode', 'rock.json');
        })

        it("selects the package target from the provided list", async function() {
            let choices : context.DebuggingTargetChoice[] = [
                {
                    'label': 'label1',
                    'description': 'descriptiont1',
                    'targetName': 'name1',
                    'targetFile': 'path1'
                },
                {
                    'label': 'label2',
                    'description': 'descriptiont2',
                    'targetName': 'name2',
                    'targetFile': 'path2'
                }
            ];

            testContext.mockWrapper.setup(x => x.showQuickPick(choices, TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(choices[0]));

            await testContext.subject.pickDebuggingTarget(packagePath, choices, {}, undefined);
            const selectedTarget = testContext.subject.getDebuggingTarget(packagePath);
            assert(selectedTarget);
            if (selectedTarget) {
                assert.equal(selectedTarget.name, 'name1');
                assert.equal(selectedTarget.path, 'path1');
            }
        })

        it("does not modify the selection if the picker is cancelled", async function() {
            testContext.mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));

            let expected = new debug.Target('name', 'path')
            testContext.subject.setDebuggingTarget(packagePath, expected);
            await testContext.subject.pickDebuggingTarget(packagePath, [], {}, undefined);
            const selectedTarget = testContext.subject.getDebuggingTarget(packagePath);
            assert.deepEqual(expected, selectedTarget);
        })
    })

    describe("pickDebuggingFile", function() {
        let packagePath : string;

        beforeEach(function() {
            packagePath = helpers.mkdir('package');
            helpers.registerDir('package', '.vscode');
            helpers.registerFile('package', '.vscode', 'rock.json');
        })

        it("selects the package target from the file system", async function() {
            testContext.mockWrapper.setup(x => x.showOpenDialog(TypeMoq.It.isAny())).
                returns(() => Promise.resolve([vscode.Uri.file('/picked/file')]));

            await testContext.subject.pickDebuggingFile(packagePath);
            const selectedTarget = testContext.subject.getDebuggingTarget(packagePath);
            assert(selectedTarget);
            if (selectedTarget) {
                assert.equal(selectedTarget.name, 'file');
                assert.equal(selectedTarget.path, '/picked/file');
            }
        })

        it("does not modify the selection if the picker is cancelled", async function() {
            testContext.mockWrapper.setup(x => x.showOpenDialog(TypeMoq.It.isAny())).
                returns(() => Promise.resolve(undefined));

            let expected = new debug.Target('name', 'path')
            testContext.subject.setDebuggingTarget(packagePath, expected);
            await testContext.subject.pickDebuggingFile(packagePath);
            const selectedTarget = testContext.subject.getDebuggingTarget(packagePath);
            assert.deepEqual(expected, selectedTarget);
        })
    })
});
