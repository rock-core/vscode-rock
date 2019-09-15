import * as linter from '../src/linter'
import * as helpers from './helpers';
import * as TypeMoq from 'typemoq';
import * as autoproj from '../src/autoproj';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as wrappers from '../src/wrappers';
import { Context } from '../src/context';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe("Linter", function () {
    let subject: linter.Linter;
    let mockContext: TypeMoq.IMock<Context>;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockCollection: TypeMoq.IMock<vscode.DiagnosticCollection>;
    beforeEach(() => {
        mockContext = TypeMoq.Mock.ofType();
        mockWrapper = TypeMoq.Mock.ofType();
        mockCollection = TypeMoq.Mock.ofType();
        subject = new linter.Linter(mockContext.object,
            mockWrapper.object, mockCollection.object);
    })
    afterEach(() => {
    })
    describe("start()", () => {
        let mockSubject: TypeMoq.IMock<linter.Linter>;
        beforeEach(() => {
            mockSubject = TypeMoq.Mock.ofInstance(subject);
            subject = mockSubject.target;
        });
        it("does not run linter twice in a short period", async () => {
            let count = 0;
            mockSubject.setup((x) => x.lintDocument()).returns(() => {
                count++;
                return Promise.resolve(undefined);
            });

            subject.start();
            subject.start();
            await sleep(1500);
            assert.equal(1, count);
        });
    });
    describe("lintDocument()", () => {
        let mockEditor: TypeMoq.IMock<vscode.TextEditor>;
        let mockDocument: TypeMoq.IMock<vscode.TextDocument>;
        let mockWorkspace: TypeMoq.IMock<autoproj.Workspace>;
        beforeEach(() => {
            mockEditor = TypeMoq.Mock.ofType();
            mockDocument = TypeMoq.Mock.ofType();
            mockWorkspace = TypeMoq.Mock.ofType();
            mockEditor.setup((x: any) => x.then).returns(() => undefined);
            mockDocument.setup((x: any) => x.then).returns(() => undefined);
            mockWorkspace.setup((x: any) => x.then).returns(() => undefined);
            mockEditor.setup((x) => x.document).returns(() => mockDocument.object);
        });
        it("does not update diagnostic collection if no active editor", async () => {
            mockWrapper.setup((x) => x.activeTextEditor).returns(() => undefined);
            assert.equal(undefined, await subject.lintDocument());
        });
        it("does not run vera if language not supported", async () => {
            mockWrapper.setup((x) => x.activeTextEditor).returns(() => mockEditor.object);
            mockDocument.setup((x) => x.languageId).returns(() => "ruby");
            assert.equal(undefined, await subject.lintDocument());
        });
        it("does not run vera if document is not in code's workspace", async () => {
            mockWrapper.setup((x) => x.activeTextEditor).returns(() => mockEditor.object);
            mockDocument.setup((x) => x.languageId).returns(() => "cpp");
            mockDocument.setup((x) => x.fileName).returns(() => "/foo/bar.cpp");
            mockWrapper.setup((x) => x.getWorkspaceFolder("/foo/bar.cpp")).returns(() => undefined);
            assert.equal(undefined, await subject.lintDocument());
        });
        describe("has a valid document", () => {
            let mockProcess: autoproj.Process;
            const ws: vscode.WorkspaceFolder = {
                index: 0,
                name: "foo",
                uri: vscode.Uri.file("/foo"),
            }
            beforeEach(() => {
                mockProcess = helpers.createProcessMock();
                mockWrapper.setup((x) => x.activeTextEditor).returns(() => mockEditor.object);
                mockDocument.setup((x) => x.languageId).returns(() => "cpp");
                mockDocument.setup((x) => x.fileName).returns(() => "/foo/bar.cpp");
                mockWrapper.setup((x) => x.getWorkspaceFolder("/foo/bar.cpp")).returns(() => ws);
                mockCollection.setup((x: any) => x.then).returns(() => undefined);
                require('child_process').spawn = function (...args) { return mockProcess };
            });
            it("does not run vera if document is not in autoproj's workspace", async () => {
                mockContext.setup((x) => x.getWorkspaceByPath("/foo")).returns(() => undefined);
                assert.equal(undefined, await subject.lintDocument());
            });
            it("runs vera linting tool", async () => {
                mockContext.setup((x) => x.getWorkspaceByPath("/foo")).returns(() => mockWorkspace.object);
                mockWorkspace.setup((x) => x.autoprojExec("vera++", ["/foo/bar.cpp"])).returns(() => mockProcess);

                const diagnosticPromise = subject.lintDocument();
                mockProcess.emit('exit', 0, null);
                assert.notEqual(undefined, await diagnosticPromise);
            });
            it("parses linter violations", async () => {
                const uri = vscode.Uri.file("/foo/bar.cpp");
                const textLine = TypeMoq.Mock.ofType<vscode.TextLine>();
                const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

                textLine.setup((x) => x.text).returns(() => "fooBar()")
                mockDocument.setup((x) => x.lineAt(0)).returns(() => textLine.object);
                mockDocument.setup((x) => x.uri).returns(() => uri);
                mockWorkspace.setup((x) => x.autoprojExec("vera++", ["/foo/bar.cpp"]))
                    .returns(() => mockProcess);
                mockCollection.setup((x) => x.set(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                    .callback((uri, diagnostic) => diagnosticMap.set(uri.fsPath, diagnostic));
                mockContext.setup((x) => x.getWorkspaceByPath("/foo"))
                    .returns(() => mockWorkspace.object);
                mockWrapper.setup((x) => x.openTextDocument("/foo/bar.cpp"))
                    .returns(() => Promise.resolve(mockDocument.object));

                const diagnosticPromise = subject.lintDocument();
                mockProcess.stdout.emit('data', "/foo/bar.cpp:1: some linter violation\n");
                mockProcess.emit('exit', 0, null);

                assert.strictEqual(mockCollection.object, await diagnosticPromise);
                assert.equal(1, diagnosticMap.size);

                const diagnostics = diagnosticMap.get(uri.fsPath);
                assert.equal(1, diagnostics!.length);

                const diagnostic = diagnostics![0];
                assert.equal("some linter violation", diagnostic.message);
                assert.equal(0, diagnostic.range.start.line);
                assert.equal(8, diagnostic.range.end.character);
            });
        });
    });
});