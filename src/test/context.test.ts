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

describe("Context tests", function () {
    let subject: context.Context;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockEventEmitter: TypeMoq.IMock<vscode.EventEmitter<void>>;
    let mockPackageFactory: TypeMoq.IMock<packages.PackageFactory>;
    let mockPackage: TypeMoq.IMock<packages.Package>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    let workspaces: autoproj.Workspaces;
    beforeEach(function () {
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockEventEmitter = TypeMoq.Mock.ofType<vscode.EventEmitter<void>>();
        mockPackageFactory = TypeMoq.Mock.ofType<packages.PackageFactory>();
        mockPackage = TypeMoq.Mock.ofType<packages.Package>();
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        mockPackage.setup((x: any) => x.then).returns(() => undefined);
        workspaces = new autoproj.Workspaces;

        subject = new context.Context(mockContext.object, mockWrapper.object,
            workspaces, mockPackageFactory.object, mockEventEmitter.object, mockBridge.object);
    })

    it("returns the given vscode wrapper", function () {
        assert.strictEqual(mockWrapper.object, subject.vscode);
    });

    it("returns the given extension context", function () {
        assert.strictEqual(mockContext.object, subject.extensionContext);
    });

    it("returns the given workspaces", function () {
        assert.strictEqual(workspaces, subject.workspaces);
    });

    it("returns the given environment bridge", function () {
        assert.strictEqual(mockBridge.object, subject.bridge);
    });

    it("gets the package selection mode", function () {
        let mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>;

        mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        mockWrapper.setup(x => x.getConfiguration('rock')).returns(() => mockWorkspaceConf.object);
        let selectionMode = subject.packageSelectionMode;
        mockWorkspaceConf.verify(x => x.get('packageSelectionMode'), TypeMoq.Times.once());
    });
    it("sets the selected package and fires the event", function () {
        let mockWorkspaceState: TypeMoq.IMock<vscode.Memento>;
        mockWorkspaceState = TypeMoq.Mock.ofType<vscode.Memento>();

        let path = '/path/to/package';
        mockContext.setup(x => x.workspaceState).returns(() => mockWorkspaceState.object);
        subject.setSelectedPackage(path);
        mockWorkspaceState.verify(x => x.update('rockSelectedPackage', path), TypeMoq.Times.once());
        mockEventEmitter.verify(x => x.fire(), TypeMoq.Times.once());
    });

    describe("get selectedPackage", function() {
        describe("on an empty workspace", function() {
            it("creates an invalid package", async function () {
                mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
                mockPackageFactory.setup(x => x.createPackage(null, subject)).
                    returns(() => Promise.resolve(mockPackage.object));

                let pkg = await subject.getSelectedPackage();
                assert.equal(pkg, mockPackage.object);
                mockPackageFactory.verify(x => x.createPackage(null, subject),
                    TypeMoq.Times.once());
            });
        })

        describe("on a non-empty workspace", function() {
            let mockWorkspaceFolder1: TypeMoq.IMock<vscode.WorkspaceFolder>;
            let mockWorkspaceFolder2: TypeMoq.IMock<vscode.WorkspaceFolder>;
            let mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
            
            beforeEach(function () {
                let workspaceFolders = new Array<vscode.WorkspaceFolder>();
                let uri1 = vscode.Uri.file('/etc/');
                let uri2 = vscode.Uri.file('/bin/');

                mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();                
                mockWorkspaceFolder1 = TypeMoq.Mock.ofType<vscode.WorkspaceFolder>();
                mockWorkspaceFolder2 = TypeMoq.Mock.ofType<vscode.WorkspaceFolder>();
                mockWorkspaceFolder1.setup(x => x.uri).returns(() => uri1);
                mockWorkspaceFolder2.setup(x => x.uri).returns(() => uri2);

                workspaceFolders.push(mockWorkspaceFolder1.object);
                workspaceFolders.push(mockWorkspaceFolder2.object);
                mockWrapper.setup(x => x.workspaceFolders).returns(() => workspaceFolders);                
            })

            describe("in manual package selection mode", function() {
                let mockWorkspaceState: TypeMoq.IMock<vscode.Memento>;
                beforeEach(function () {
                    mockWorkspaceState = TypeMoq.Mock.ofType<vscode.Memento>();
                    mockWorkspaceConf.setup(x => x.get('packageSelectionMode')).returns(() => 'manual');
                    mockWrapper.setup(x => x.getConfiguration('rock')).returns(() => mockWorkspaceConf.object);
                    mockContext.setup(x => x.workspaceState).returns(() => mockWorkspaceState.object);
                })

                it("creates an invalid package if no package is selected", async function () {
                    mockWorkspaceState.setup(x => x.get('rockSelectedPackage')).returns(() => null);
                    mockPackageFactory.setup(x => x.createPackage(null, subject)).
                        returns(() => Promise.resolve(mockPackage.object));

                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage(null, subject),
                        TypeMoq.Times.once());
                });
                it("creates an invalid package if the selected package no longer belongs to workspace", async function () {
                    mockWorkspaceState.setup(x => x.get('rockSelectedPackage')).returns(() => '/usr/');
                    mockPackageFactory.setup(x => x.createPackage(null, subject)).
                        returns(() => Promise.resolve(mockPackage.object));

                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage(null, subject),
                        TypeMoq.Times.once());
                });
                it("creates the package representation", async function () {
                    mockWorkspaceState.setup(x => x.get('rockSelectedPackage')).returns(() => '/etc/');
                    mockPackageFactory.setup(x => x.createPackage('/etc/', subject)).
                        returns(() => Promise.resolve(mockPackage.object));

                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage('/etc/', subject),
                        TypeMoq.Times.once());
                });
            })

            describe("in auto package selection mode", function() {
                let mockTextEditor: TypeMoq.IMock<vscode.TextEditor>;
                let mockDocument: TypeMoq.IMock<vscode.TextDocument>;
                beforeEach(function () {
                    mockTextEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();
                    mockDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();

                    mockWorkspaceConf.setup(x => x.get('packageSelectionMode')).returns(() => 'auto');
                    mockWrapper.setup(x => x.getConfiguration('rock')).returns(() => mockWorkspaceConf.object);
                })

                it("creates an invalid package if no file is being edited", async function () {
                    mockWrapper.setup(x => x.activeTextEditor).returns(() => undefined);
                    mockPackageFactory.setup(x => x.createPackage(null, subject)).
                        returns(() => Promise.resolve(mockPackage.object));

                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage(null, subject),
                        TypeMoq.Times.once());
                });

                it("creates an invalid package if the file's uri scheme is not 'file'", async function () {
                    let fileUri = vscode.Uri.parse('ftp://ftp.foo.com/bar/');

                    mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
                    mockTextEditor.setup(x => x.document).returns(() => mockDocument.object);
                    mockDocument.setup(x => x.uri).returns(() => fileUri);
                    mockPackageFactory.setup(x => x.createPackage(null, subject)).
                        returns(() => Promise.resolve(mockPackage.object));

                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage(null, subject),
                        TypeMoq.Times.once());
                });

                it("creates an invalid package if the file does not belong to any package", async function () {
                    let fileUri = vscode.Uri.file('/usr/bin/whoami');

                    mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
                    mockTextEditor.setup(x => x.document).returns(() => mockDocument.object);
                    mockDocument.setup(x => x.uri).returns(() => fileUri);
                    mockWrapper.setup(x => x.getWorkspaceFolder(fileUri)).returns(() => undefined);
                    mockPackageFactory.setup(x => x.createPackage(null, subject)).
                        returns(() => Promise.resolve(mockPackage.object));

                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage(null, subject),
                        TypeMoq.Times.once());
                });

                it("creates the package representation of the package that owns the file", async function () {
                    let fileUri = vscode.Uri.file('/etc/passwd');
                    
                    mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
                    mockTextEditor.setup(x => x.document).returns(() => mockDocument.object);
                    mockDocument.setup(x => x.uri).returns(() => fileUri);
                    mockWrapper.setup(x => x.getWorkspaceFolder(fileUri)).returns(() => mockWorkspaceFolder1.object);

                    mockPackageFactory.setup(x => x.createPackage('/etc/', subject)).
                        returns(() => Promise.resolve(mockPackage.object));
                    let pkg = await subject.getSelectedPackage();
                    assert.equal(pkg, mockPackage.object);
                    mockPackageFactory.verify(x => x.createPackage('/etc/', subject),
                        TypeMoq.Times.once());
                });
            })
        })
    })
});