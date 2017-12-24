'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../wrappers';
import * as context from '../context';
import * as autoproj from '../autoproj';
import * as helpers from './helpers';
import * as packages from '../packages';
import * as async from '../async';
import { basename } from 'path';

class TestContext
{
    mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    mockEventEmitter: TypeMoq.IMock<vscode.EventEmitter<void>>;
    mockPackageFactory: TypeMoq.IMock<packages.PackageFactory>;
    mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    workspaces: autoproj.Workspaces;

    mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
    mockWorkspaceState: TypeMoq.IMock<vscode.Memento>;
    workspaceFolders: vscode.WorkspaceFolder[];
    mockTextEditor: TypeMoq.IMock<vscode.TextEditor>;
    mockDocument: TypeMoq.IMock<vscode.TextDocument>;

    subject: context.Context;
    private _activeEditor;
    constructor()
    {
        this.mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        this.mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        this.mockEventEmitter = TypeMoq.Mock.ofType<vscode.EventEmitter<void>>();
        this.mockPackageFactory = TypeMoq.Mock.ofType<packages.PackageFactory>();
        this.mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        this.workspaces = new autoproj.Workspaces;

        this.subject = new context.Context(this.mockContext.object,
            this.mockWrapper.object, this.workspaces,
            this.mockPackageFactory.object, this.mockEventEmitter.object,
            this.mockBridge.object);

        this.mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        this.mockWorkspaceState = TypeMoq.Mock.ofType<vscode.Memento>();
        this.workspaceFolders = new Array<vscode.WorkspaceFolder>();
        this.mockTextEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();
        this.mockDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();

        this.mockContext.setup(x => x.workspaceState).
            returns(() => this.mockWorkspaceState.object);

        this.mockWrapper.setup(x => x.workspaceFolders).
            returns(() => this.workspaceFolders);

        this.mockWrapper.setup(x => x.activeTextEditor).
            returns(() => this.editor());

        this.mockTextEditor.setup(x => x.document).
            returns(() => this.mockDocument.object);
    }

    private editor(): vscode.TextEditor
    {
        return this._activeEditor;
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
        let folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(path),
            name: basename(path),
            index: this.workspaceFolders.length
        };

        this.workspaceFolders.push(folder);
    }

    addWorkspaceState<T>(key: string, value: T): void
    {
        this.mockWorkspaceState.setup(x =>
            x.get(key)).returns(() => value);
    }

    setEditingResource(uri: string): vscode.Uri
    {
        let resource = vscode.Uri.parse(uri);
        this.mockDocument.setup(x => x.uri).returns(() => resource);
        return resource;
    }

    associateResourceWithFolder(resource: vscode.Uri,
        folder: vscode.WorkspaceFolder): void
    {
        this.mockWrapper.setup(x => x.getWorkspaceFolder(resource)).
            returns(() => folder);
    }

    openEditor(): void
    {
        this._activeEditor = this.mockTextEditor.object;
    }

    closeEditor(): void
    {
        this._activeEditor = undefined;
    }
}

describe("Context tests", function () {
    let testContext: TestContext;
    beforeEach(function () {
        testContext = new TestContext;
    })
    it("returns the given vscode wrapper", function () {
        assert.strictEqual(testContext.mockWrapper.object, testContext.subject.vscode);
    });

    it("returns the given extension context", function () {
        assert.strictEqual(testContext.mockContext.object, testContext.subject.extensionContext);
    });

    it("returns the given workspaces", function () {
        assert.strictEqual(testContext.workspaces, testContext.subject.workspaces);
    });

    it("returns the given environment bridge", function () {
        assert.strictEqual(testContext.mockBridge.object, testContext.subject.bridge);
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

        testContext.mockWorkspaceState.verify(x =>
            x.update('rockSelectedPackage', path), TypeMoq.Times.once());

        testContext.mockEventEmitter.verify(x =>
            x.fire(), TypeMoq.Times.once());
    });

    describe("get selectedPackage", function() {
        describe("on an empty workspace", function() {
            beforeEach(function () {
            })
            it("creates an invalid package", async function () {
                let mock = testContext.addPackageFactory(undefined);
                let pkg = await testContext.subject.getSelectedPackage();

                assert.equal(pkg, mock);
                testContext.mockPackageFactory.verify(x =>
                    x.createPackage(undefined, testContext.subject), TypeMoq.Times.once());
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
                    let mock = testContext.addPackageFactory(undefined);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage(undefined, testContext.subject), TypeMoq.Times.once());
                });
                it("creates an invalid package if the selected package no longer belongs to workspace", async function () {
                    testContext.addWorkspaceState('rockSelectedPackage', '/a/foreign/package');

                    let mock = testContext.addPackageFactory(undefined);
                    let pkg = await testContext.subject.getSelectedPackage();

                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage(undefined, testContext.subject), TypeMoq.Times.once());
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
                    let mock = testContext.addPackageFactory(undefined);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x => x.createPackage(
                        undefined, testContext.subject), TypeMoq.Times.once());
                });
                it("creates an invalid package if the file's uri scheme is not 'file'", async function () {
                    testContext.openEditor();
                    testContext.setEditingResource('ftp://ftp.foo.com/bar/');
                    let mock = testContext.addPackageFactory(undefined);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage(undefined, testContext.subject), TypeMoq.Times.once());
                });
                it("creates an invalid package if the file does not belong to any package", async function () {
                    testContext.openEditor();
                    testContext.setEditingResource('file:///a/foreign/package');
                    let mock = testContext.addPackageFactory(undefined);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);
                    testContext.mockPackageFactory.verify(x =>
                        x.createPackage(undefined, testContext.subject), TypeMoq.Times.once());
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
                    testContext.openEditor();
                    let resource = testContext.setEditingResource('file://my/workspace/foo/file.cpp');
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
                    testContext.openEditor();
                    let resource = testContext.setEditingResource('file://my/workspace/foo/file.cpp');
                    let mock = testContext.addPackageFactory('/my/workspace/foo');
                    testContext.associateResourceWithFolder(resource, testContext.workspaceFolders[0]);
                    let pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);

                    testContext.closeEditor();
                    pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, mock);

                    testContext.workspaceFolders.shift();
                    pkg = await testContext.subject.getSelectedPackage();
                    assert.equal(pkg, undefined);
                });
            })
        })
    })
});
