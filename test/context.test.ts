'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../src/wrappers';
import * as tasks from '../src/tasks';
import * as context from '../src/context';
import * as autoproj from '../src/autoproj';
import * as helpers from './helpers';
import * as packages from '../src/packages';
import * as async from '../src/async';
import { basename, join } from 'path';
import * as fs from 'fs'
import * as debug from '../src/debug'

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
    it ("creates an output channel when instantiated", function () {
        let mockOutputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        let mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        let mockWorkspaces = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        let mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        let mockPackageFactory = TypeMoq.Mock.ofType<packages.PackageFactory>();

        mockWrapper.setup(x => x.createOutputChannel("Rock")).
            returns(() => mockOutputChannel.object);
        let subject = new context.Context(mockWrapper.object, mockWorkspaces.object,
            mockPackageFactory.object);
        mockWrapper.verify(x => x.createOutputChannel("Rock"), TypeMoq.Times.once());
        assert.strictEqual(subject.outputChannel, mockOutputChannel.object);
    });
    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });

    it("gets the package selection mode", function () {
        testContext.addWorkspaceConfiguration('rock');
        testContext.addConfigurationValue('packageSelectionMode', "auto");

        let selectionMode = testContext.subject.packageSelectionMode;
        assert.equal(selectionMode, "auto");
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
});
