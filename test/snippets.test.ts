import * as snippets from '../src/snippets';
import * as context from '../src/context';
import * as wrappers from '../src/wrappers';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as assert from 'assert';
import * as packages from '../src/packages';
import * as autoproj from '../src/autoproj';
import { basename, relative } from 'path';

function autoprojMakePackage(name, type, path) {
    return {
        name: name,
        type: type,
        srcdir: path,
        builddir: '/path/to/builddir',
        prefix: '',
        vcs: { type: 'git', url: '', repository_id: '' },
        logdir: '',
        dependencies: []
    }
}

describe("LaunchSnippetProvider", function () {
    let subject: snippets.LaunchSnippetProvider;
    let mockContext: TypeMoq.IMock<context.Context>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let filePath: string;
    let insertRelativeFilePath: (path: string) => void;
    let insertRelativeExecutablePath: (path: string) => void;
    let insertTaskName: (path: string) => void;
    beforeEach(function () {
        filePath = '/path/to/file';
        mockContext = TypeMoq.Mock.ofType<context.Context>();
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();

        mockWrapper.setup(x => x.registerAndSubscribeCommand(
            'rock.insertRelativeFilePath', TypeMoq.It.isAny())).
            callback((name, fn) => insertRelativeFilePath = fn);

        mockWrapper.setup(x => x.registerAndSubscribeCommand(
            'rock.insertRelativeExecutablePath', TypeMoq.It.isAny())).
            callback((name, fn) => insertRelativeExecutablePath = fn);

            
        mockWrapper.setup(x => x.registerAndSubscribeCommand(
            'rock.insertTaskName', TypeMoq.It.isAny())).
            callback((name, fn) => insertTaskName = fn);
        
        subject = new snippets.LaunchSnippetProvider(mockContext.object,
            mockWrapper.object)
    })
    describe("internal commands", function () {
        let mockReplacer: TypeMoq.IMock<(editor: vscode.TextEditor, text: string) => void>;
        let mockTextEditor: TypeMoq.IMock<vscode.TextEditor>;
        let editor: vscode.TextEditor | undefined;
        let text: string;
        beforeEach(function () {
            mockTextEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();
            mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
            mockReplacer = TypeMoq.Mock.ofType();
            subject.replaceEditorSelection = mockReplacer.object;
        })
        describe("insertRelativeFilePath()", function () {
            it("replaces placeholder with picked file", async function () {
                mockContext.setup(x => x.pickFile("/path/to")).
                    returns(() => Promise.resolve([vscode.Uri.file(filePath)]));
                await insertRelativeFilePath("/path/to");
                mockReplacer.verify(x => x(mockTextEditor.object, "file"),
                    TypeMoq.Times.once());
            })
            it("does not replace placeholder if canceled", async function () {
                mockContext.setup(x => x.pickFile("/path/to")).
                    returns(() => Promise.resolve(undefined));
                await insertRelativeFilePath("/path/to");
                mockReplacer.verify(x => x(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.never());
            })
        })
        describe("insertRelativeExecutablePath()", function () {
            it("replaces placeholder with picked executable", async function () {
                mockContext.setup(x => x.pickExecutable("/path/to")).
                    returns(() => Promise.resolve(filePath));
                await insertRelativeExecutablePath("/path/to");
                mockReplacer.verify(x => x(mockTextEditor.object, "file"),
                    TypeMoq.Times.once());
            })
            it("does not replace placeholder if canceled", async function () {
                mockContext.setup(x => x.pickExecutable("/path/to")).
                    returns(() => Promise.resolve(undefined));
                await insertRelativeExecutablePath("/path/to");
                mockReplacer.verify(x => x(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.never());
            })
            it("shows a warning message if picker fails", async function () {
                mockContext.setup(x => x.pickExecutable("/path/to")).
                    returns(() => Promise.reject(new Error("test")));
                await insertRelativeExecutablePath("/path/to");
                mockWrapper.verify(x => x.showWarningMessage("test"), TypeMoq.Times.once());
                mockReplacer.verify(x => x(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.never());                
            })
        })
        describe("insertTaskName()", function () {
            let aPackage: packages.RockRubyPackage;
            let workspace: autoproj.Workspace;
            beforeEach(function () {
                workspace = new autoproj.Workspace("/path", false);
                aPackage = new packages.RockRubyPackage(workspace,
                    autoprojMakePackage('to', 'Autobuild::Orogen', "/path/to"),
                    mockContext.object, mockWrapper.object);
                mockContext.setup(x => x.getPackageByPath(filePath)).
                    returns(() => Promise.resolve(aPackage));
            })
            it("replaces placeholder with picked task", async function () {
                let deployment = {
                    name: 'test_deployment',
                    project_name: 'test',
                    default_deployment_for: 'test::Task',
                    default_logger: undefined,
                    tasks: []
                }
                mockContext.setup(x => x.getPackageByPath("/path/to")).
                    returns(() => Promise.resolve(aPackage));
                mockContext.setup(x => x.pickTask(workspace)).
                    returns(() => Promise.resolve(deployment));
                await insertTaskName("/path/to");
                mockReplacer.verify(x => x(mockTextEditor.object, "test::Task"),
                    TypeMoq.Times.once());
            })
            it("replaces placeholder with picked deployment", async function () {
                let deployment = {
                    name: 'test_deployment',
                    project_name: 'test',
                    default_deployment_for: undefined,
                    default_logger: undefined,
                    tasks: []
                }
                mockContext.setup(x => x.getPackageByPath("/path/to")).
                    returns(() => Promise.resolve(aPackage));
                mockContext.setup(x => x.pickTask(workspace)).
                    returns(() => Promise.resolve(deployment));
                await insertTaskName("/path/to");
                mockReplacer.verify(x => x(mockTextEditor.object, "test_deployment"),
                    TypeMoq.Times.once());
            })
            it("does not replace placeholder if canceled", async function () {
                mockContext.setup(x => x.getPackageByPath("/path/to")).
                    returns(() => Promise.resolve(aPackage));
                mockContext.setup(x => x.pickTask(workspace)).
                    returns(() => Promise.resolve(undefined));
                await insertTaskName("/path/to");
                mockReplacer.verify(x => x(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.never());                
            })
            it("shows a warning message if picker fails", async function () {
                mockContext.setup(x => x.getPackageByPath("/path/to")).
                    returns(() => Promise.resolve(aPackage));
                mockContext.setup(x => x.pickTask(workspace)).
                    returns(() => Promise.reject(new Error("test")));
                await insertTaskName("/path/to");
                mockWrapper.verify(x => x.showWarningMessage("test"), TypeMoq.Times.once());
                mockReplacer.verify(x => x(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.never());                
            })
        })
    })
    describe("provideCompletionItems()", function () {
        let mockDocument: TypeMoq.IMock<vscode.TextDocument>;
        let mockPosition: TypeMoq.IMock<vscode.Position>;
        let mockToken: TypeMoq.IMock<vscode.CancellationToken>;
        let mockCompletionContext: TypeMoq.IMock<vscode.CompletionContext>;
        beforeEach(function () {
            mockDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();
            mockPosition = TypeMoq.Mock.ofType<vscode.Position>();
            mockToken = TypeMoq.Mock.ofType<vscode.CancellationToken>();
            mockCompletionContext = TypeMoq.Mock.ofType<vscode.CompletionContext>();
            mockDocument.setup(x => x.fileName).returns(() => filePath);
        })
        describe("file is NOT within an workspace folder", function () {
            beforeEach(function () {
                mockWrapper.setup(x => x.getWorkspaceFolder(filePath)).
                    returns(() => undefined);
            })
            it("returns an empty array of completion items", async function() {
                let items = await subject.provideCompletionItems(mockDocument.object,
                    mockPosition.object, mockToken.object, mockCompletionContext.object)
                assert.equal((items as vscode.CompletionItem[]).length, 0);
            })
        })
        describe("file is within an workspace folder", function () {
            let folder: vscode.WorkspaceFolder;
            let configurations: { configurations: Array<any> };
            beforeEach(function () {
                folder = {
                    uri: vscode.Uri.file(filePath),
                    index: 0,
                    name: basename(filePath)
                }
                configurations = { configurations: [] };
                mockWrapper.setup(x => x.getWorkspaceFolder(filePath)).
                    returns(() => folder);
            })
            describe("package type is not supported", function () {
                beforeEach(function () {
                    mockContext.setup(x => x.getPackageByPath(filePath)).
                        returns(() => Promise.resolve(new packages.InvalidPackage()));
                    mockDocument.setup(x => x.getText()).
                        returns(() => JSON.stringify(configurations, null, 4));
                })
                it("returns an empty array of completion items", async function() {
                    let items = await subject.provideCompletionItems(mockDocument.object,
                        mockPosition.object, mockToken.object, mockCompletionContext.object)
                    assert.equal((items as vscode.CompletionItem[]).length, 0);
                })
            });
            describe("package type is not supported", function () {
                let aPackage: packages.RockRubyPackage;
                beforeEach(function () {
                    let workspace = new autoproj.Workspace("/path", false);
                    aPackage = new packages.RockRubyPackage(workspace,
                        autoprojMakePackage('to', 'Autobuild::Ruby', "/path/to"),
                        mockContext.object, mockWrapper.object);
                    mockContext.setup(x => x.getPackageByPath(filePath)).
                        returns(() => Promise.resolve(aPackage));
                    mockDocument.setup(x => x.getText()).
                        returns(() => JSON.stringify(configurations, null, 4));
                })
                it("creates a completion item for Ruby packages", async function () {
                    let items = await subject.provideCompletionItems(mockDocument.object,
                        mockPosition.object, mockToken.object,
                        mockCompletionContext.object) as vscode.CompletionItem[];

                    let item = items.find(item => item.label == "Rock: Ruby")
                    assert(item);
                    assert.equal(item!.command!.title, "rock.insertRelativeFilePath");
                    assert.equal(item!.command!.command, "rock.insertRelativeFilePath");
                    assert.deepEqual(item!.command!.arguments, [filePath]);
                })
                it("creates a completion item for CXX packages", async function () {
                    let items = await subject.provideCompletionItems(mockDocument.object,
                        mockPosition.object, mockToken.object,
                        mockCompletionContext.object) as vscode.CompletionItem[];

                    let item = items.find(item => item.label == "Rock: C/C++")
                    assert(item);
                    assert.equal(item!.command!.title, "rock.insertRelativeExecutablePath");
                    assert.equal(item!.command!.command, "rock.insertRelativeExecutablePath");
                    assert.deepEqual(item!.command!.arguments, [aPackage.info.builddir]);
                })
                it("creates a completion item for Orogen packages", async function () {
                    let items = await subject.provideCompletionItems(mockDocument.object,
                        mockPosition.object, mockToken.object,
                        mockCompletionContext.object) as vscode.CompletionItem[];

                    let item = items.find(item => item.label == "Rock: Orogen")
                    assert(item);
                    assert.equal(item!.command!.title, "rock.insertTaskName");
                    assert.equal(item!.command!.command, "rock.insertTaskName");
                    assert.deepEqual(item!.command!.arguments, [filePath]);
                })
                describe("when there are launch configurations", function () {
                    beforeEach(function () {
                        configurations = { configurations: [{}] };
                    })
                    it("appends a comma to the end of the snippets", async function() {
                        let items = await subject.provideCompletionItems(mockDocument.object,
                            mockPosition.object, mockToken.object,
                            mockCompletionContext.object) as vscode.CompletionItem[];

                        for (let item of items) {
                            assert((item.insertText as vscode.SnippetString).value.endsWith(","));
                        }
                    })
                })
            });
        })
    })
})
